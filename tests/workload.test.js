import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { actions, validateConfig, random, chooseAction, postFields } from '../src/workload.js';

const config = JSON.parse(readFileSync('configs/pilot-small.json'));

test('approved defaults and smoke config validate', () => {
  assert.equal(validateConfig(config), config);
  validateConfig(JSON.parse(readFileSync('configs/smoke.json')));
  assert.equal(config.weights.like, 17);
  assert.equal(config.weights.unlike, 5);
});

test('custom identity pools support up to 20000 distinct active users', () => {
  for (const users of [10000, 10001, 15000, 20000]) {
    const custom = { ...config, dataset: { ...config.dataset, profile: 'custom', users }, vus: users };
    assert.equal(validateConfig(custom), custom);
    assert.throws(() => validateConfig({ ...custom, vus: users + 1 }), /distinct identity pool/);
  }
});

test('rejects unknown fields/actions, invalid weights/ranges, and undersized identity pools', () => {
  const invalid = [
    { mystery: 1 }, { weights: { ...config.weights, mystery: 0 } },
    { weights: { ...config.weights, like: 12 } }, { weights: { ...config.weights, like: -1, unlike: 23 } },
    { vus: 1001 }, { vus: 1.5 }, { thinkSeconds: [5, 1] }, { sessionSeconds: [0, 10] },
    { measurementSeconds: 0 }, { rampSeconds: NaN }, { seed: 0 }, { bodyBytes: 0 }, { bodyBytes: 16385 },
    { dataset: { ...config.dataset, users: 1 } }, { dataset: { ...config.dataset, likesPerUser: 10001 } },
    { dataset: { ...config.dataset, postsPerUser: 0 } },
    { dataset: { ...config.dataset, users: 2000 } },
    { dataset: { ...config.dataset, profile: 'custom', users: 20001 } },
  ];
  for (const patch of invalid) assert.throws(() => validateConfig({ ...config, ...patch }), JSON.stringify(patch));
});

test('payloads are deterministic logical data with bounded titles and nontrivial ASCII bodies', () => {
  const a = postFields(config, 0, 1);
  assert.deepEqual(a, postFields(config, 0, 1));
  assert.notEqual(a.body, postFields(config, 0, 2).body);
  assert.equal(Buffer.byteLength(a.body), 1024);
  assert.ok(new Set(a.body).size > 20, 'avoid a trivially compressible padding-only payload');
  assert.ok(a.title.length > 0 && a.title.length <= 200);
});

test('seeded selection is reproducible and respects every weight', () => {
  const one = random(42), two = random(42);
  const counts = Object.fromEntries(actions.map(action => [action, 0]));
  for (let i = 0; i < 100000; i++) {
    const action = chooseAction(config.weights, one);
    assert.equal(action, chooseAction(config.weights, two));
    counts[action]++;
  }
  for (const action of actions) assert.ok(Math.abs(counts[action] / 1000 - config.weights[action]) < 0.5, action);
  assert.equal(chooseAction(config.weights, () => 0), 'listPublic');
  assert.equal(chooseAction(config.weights, () => 0.999999), 'edit');
});
