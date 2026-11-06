import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { random, postFields } from '../src/workload.js';
import { payloadCachePlan, validatePayloadTable, createPayloadLookup } from '../src/payload-cache.js';
import { writePayloadCache } from '../scripts/payload-cache.js';
import { initialState, performAction } from '../src/actions.js';

const config = JSON.parse(readFileSync('configs/prepared-smoke.json'));
function originalFields(c, user, sequence) {
  let seed = c.seed;
  for (const char of `${user}:${sequence}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const rng = random(seed), alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let body = '';
  for (let i = 0; i < c.bodyBytes; i++) body += alphabet[Math.floor(rng() * alphabet.length)];
  return { title: `Post ${user} ${sequence}`.slice(0, 100), body };
}
function temp(t) { const root = mkdtempSync(tmpdir() + '/payload-cache-'); t.after(() => rmSync(root, { recursive: true })); return root + '/payloads.json'; }

test('join-based generation is byte-for-byte equivalent to the original recipe', () => {
  for (const seed of [1, 20261020, 0xffffffff]) for (const bodyBytes of [1, 63, 64, 65, 1024, 16384])
    for (const user of [0, 1999, 19999]) for (const sequence of [1, 11, 43, 10001]) {
      const c = { ...config, seed, bodyBytes };
      assert.deepEqual(postFields(c, user, sequence), originalFields(c, user, sequence));
    }
});

test('cache bounds adapt to active users and body size, including a zero-slot fallback', () => {
  const normal = payloadCachePlan({ ...config, vus: 2000 });
  assert.equal(normal.slotsPerUser, 32); assert.equal(normal.records, 64000);
  for (const vus of [1, 2000, 10000, 20000]) for (const bodyBytes of [1, 1024, 16384]) {
    const p = payloadCachePlan({ ...config, vus, bodyBytes });
    assert.ok(p.slotsPerUser >= 0 && p.slotsPerUser <= 32); assert.ok(p.records * bodyBytes <= 64 * 1024 * 1024);
  }
  const c = { ...config, vus: 20000, bodyBytes: 16384 }, p = payloadCachePlan(c);
  assert.equal(p.slotsPerUser, 0); assert.deepEqual(createPayloadLookup(c, [])(19999, 11), originalFields(c, 19999, 11));
});

test('prepared table binds the recipe/hash and preserves cache boundaries and exact fallback', async t => {
  const path = temp(t), result = await writePayloadCache(path, config), bytes = readFileSync(path), table = JSON.parse(bytes);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex')); assert.equal(result.bytes, bytes.length);
  const rows = validatePayloadTable(table, config), lookup = createPayloadLookup(config, rows);
  for (const user of [0, 1, 2]) for (let sequence = 1; sequence <= 45; sequence++) assert.deepEqual(lookup(user, sequence), originalFields(config, user, sequence));
  for (const patch of [{ seed: 1 }, { vus: 1 }, { bodyBytes: 1 }, { dataset: { ...config.dataset, postsPerUser: 1 } }]) assert.throws(() => validatePayloadTable(table, { ...config, ...patch }), /invalid_payload_cache/);
  for (const mutate of [t => t.rows.pop(), t => t.rows[0].body = '', t => t.rows[0].title = 'wrong user', t => t.recipe.extra = true]) {
    const bad = structuredClone(table); mutate(bad); assert.throws(() => validatePayloadTable(bad, config), /invalid_payload_cache/);
  }
  await assert.rejects(writePayloadCache(path, config), /EEXIST/);
});

test('cancelled preparation cannot return a usable cache descriptor', async t => {
  const path = temp(t), controller = new AbortController(), pending = writePayloadCache(path, { ...config, vus: 10 }, controller.signal);
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.throws(() => JSON.parse(readFileSync(path)));
});

test('cached mutations preserve sequence on failure and use exact fallback after exhaustion', async t => {
  const path = temp(t); await writePayloadCache(path, config);
  const lookup = createPayloadLookup(config, validatePayloadTable(JSON.parse(readFileSync(path)), config));
  const state = initialState({ id: 'u1', index: 0, posts: ['p1'], likes: [] }, ['p1'], config);
  const bodies = []; let fail = true;
  const client = { records: () => ({ create: async fields => { bodies.push(fields); if (fail) throw new Error('injected'); return 'new'; }, update: async (_id, fields) => bodies.push({ author: 'u1', ...fields }) }) };
  const run = action => performAction(client, state, action, config, () => 0, () => assert.fail(), lookup);
  await assert.rejects(run('create'), /injected/); assert.equal(state.sequence, 10);
  fail = false; await run('create'); assert.deepEqual(bodies[0], bodies[1]);
  for (let i = 0; i < 35; i++) await run('edit');
  for (let i = 1; i < bodies.length; i++) assert.deepEqual(bodies[i], { author: 'u1', ...originalFields(config, 0, 10 + i) });
});
