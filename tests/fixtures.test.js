import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';

export function memoryClients() {
  const users = new Map(), posts = new Map(), likes = new Map();
  let sequence = 0, sessions = 0;
  const calls = [];
  const factory = () => {
    let user;
    return {
      async register({ username, password }) { users.set(username, { id: `u${++sequence}`, username, password }); },
      async login(username, password) { const found = users.get(username); assert.equal(found.password, password); user = found; sessions++; },
      user: () => user && { id: user.id, username: user.username },
      async logout() { if (user) sessions--; user = undefined; return true; },
      async deleteUser() {
        for (const [id, post] of posts) if (post.author === user.id) posts.delete(id);
        for (const [id, like] of likes) if (like.user === user.id || !posts.has(like.post)) likes.delete(id);
        users.delete(user.username); sessions--; user = undefined;
      },
      records(table) {
        const rows = table === 'posts' ? posts : likes;
        const insert = fields => { const id = `r${++sequence}`; rows.set(id, { id, ...fields, created_at: 1, updated_at: 1 }); return id; };
        return {
          async create(fields) { calls.push({ table, method: 'create', size: 1 }); return insert(fields); },
          async createBulk(records) { calls.push({ table, method: 'createBulk', size: records.length }); return records.map(insert); },
          async list(opts = {}) {
            const filtered = [...rows.values()].filter(row => (table !== 'likes' || row.user === user.id) && (opts.filters ?? []).every(f => row[f.column] === f.value));
            return { records: filtered.slice(0, opts.pagination?.limit ?? 20), ...(opts.count ? { total_count: filtered.length } : {}) };
          },
        };
      },
    };
  };
  return { factory, users, posts, likes, calls, sessions: () => sessions };
}
const config = JSON.parse(readFileSync('configs/smoke.json'));

test('API seeding verifies exact rows, stores no tokens, logs out, and API deletion resets data', async () => {
  const backend = memoryClients();
  const snapshots = [];
  const fixture = await seedFixture(config, backend.factory, value => snapshots.push(JSON.parse(JSON.stringify(value))));
  assert.equal(fixture.status, 'ready');
  assert.equal(fixture.users.length, 4);
  assert.equal(backend.posts.size, 40);
  assert.equal(backend.likes.size, 40);
  assert.equal(backend.sessions(), 0);
  assert.ok(snapshots.length >= 2);
  assert.doesNotMatch(JSON.stringify(fixture), /auth_token|refresh_token/);
  assert.equal(new Set(fixture.users.map(u => u.password)).size, 4);
  await verifyFixture(config, fixture, backend.factory);
  const wrong = structuredClone(fixture); wrong.users[0].id = 'another-user';
  await assert.rejects(() => deleteFixture(wrong, backend.factory), /identity/);
  assert.equal(backend.users.size, 4);
  await deleteFixture(fixture, backend.factory);
  assert.equal(backend.users.size, 0);
  assert.equal(backend.posts.size, 0);
  assert.equal(backend.likes.size, 0);
  assert.equal(backend.sessions(), 0);
});

test('API-verified logical baseline hashes ignore native identities/times but reject changed like recipes', async () => {
  const backend = memoryClients();
  const first = await seedFixture(config, backend.factory, () => {});
  assert.match(first.baseline.logicalHash ?? '', /^[a-f0-9]{64}$/);
  await deleteFixture(first, backend.factory);
  const second = await seedFixture(config, backend.factory, () => {});
  assert.notEqual(first.users[0].id, second.users[0].id);
  assert.notEqual(first.users[0].password, second.users[0].password);
  for (const post of backend.posts.values()) post.created_at = post.updated_at = 200;
  assert.equal((await verifyFixture(config, second, backend.factory)).logicalHash, first.baseline.logicalHash);
  const like = second.users[0].likes[0];
  like.post = second.users[0].posts[0];
  backend.likes.get(like.id).post = like.post;
  await assert.rejects(() => verifyFixture(config, second, backend.factory), /Like recipe/);
  await deleteFixture(second, backend.factory);
  const changed = await seedFixture({ ...config, seed: config.seed + 1 }, backend.factory, () => {});
  assert.notEqual(changed.baseline.logicalHash, first.baseline.logicalHash, 'different API-observed payloads must change the digest');
});

test('partial seeds remain failed, keep credentials for cleanup, and cannot verify as a baseline', async () => {
  const backend = memoryClients();
  let saved;
  const factory = () => {
    const client = backend.factory();
    const records = client.records;
    client.records = table => ({ ...records(table), create: async () => { throw new Error('injected failure'); }, createBulk: async () => { throw new Error('injected failure'); } });
    return client;
  };
  await assert.rejects(() => seedFixture(config, factory, f => { saved = structuredClone(f); }), /injected failure/);
  assert.equal(saved.status, 'failed');
  assert.ok(saved.users[0].password);
  assert.equal(backend.sessions(), 0);
  await assert.rejects(() => verifyFixture(config, saved, backend.factory), /ready/);
});

test('preparation batches each user through the official SDK without changing the verified logical baseline', async () => {
  const backend = memoryClients();
  const fixture = await seedFixture(config, backend.factory, () => {});
  assert.equal(fixture.preparationMethod, 'sdk-bulk-per-user-v1');
  assert.deepEqual(backend.calls, ['posts', 'likes'].flatMap(table => Array.from({ length: config.dataset.users }, () => ({ table, method: 'createBulk', size: 10 }))));
  assert.equal(fixture.baseline.logicalHash, '4dda0571fa660dc11df1d1b1dc897685d52233cde45306719d47061ea3631350');
});

test('malformed bulk IDs fail closed for either table, without individual-create fallback or another batch', async () => {
  for (const table of ['posts', 'likes']) for (const response of [undefined, [], Array(10).fill('duplicate'), Array(10).fill(7)]) {
    const backend = memoryClients(); let saved, attempts = 0;
    const factory = () => {
      const client = backend.factory(), records = client.records;
      client.records = name => ({ ...records(name), ...(name === table ? { createBulk: async rows => { attempts++; await records(name).createBulk(rows); return response; } } : {}) });
      return client;
    };
    await assert.rejects(() => seedFixture(config, factory, f => { saved = structuredClone(f); }), /Bulk preparation IDs/);
    assert.equal(attempts, 1); assert.equal(saved.status, 'failed'); assert.equal(backend.sessions(), 0);
    assert.ok(saved.users[0].password); assert.equal(backend.calls.some(c => c.method === 'create'), false);
    await assert.rejects(() => verifyFixture(config, saved, backend.factory), /ready/);
  }
});

test('a committed-but-unacknowledged batch preserves the original error and failed fixture without retries or deletion', async () => {
  const backend = memoryClients(), failure = new Error('unacknowledged bulk write'); let saved, attempts = 0;
  const factory = () => {
    const client = backend.factory(), records = client.records;
    client.records = table => ({ ...records(table), createBulk: async rows => { attempts++; await records(table).createBulk(rows); throw failure; } });
    return client;
  };
  await assert.rejects(() => seedFixture(config, factory, f => { saved = structuredClone(f); }), e => e === failure);
  assert.equal(attempts, 1); assert.equal(saved.status, 'failed'); assert.equal(saved.users[0].posts.length, 0);
  assert.equal(backend.posts.size, 10); assert.equal(backend.users.size, 1); assert.equal(backend.sessions(), 0);
  assert.ok(saved.users[0].password);
});

test('single-row custom fixtures still use supported bulk calls and retain exact API verification', async () => {
  const backend = memoryClients(), custom = { ...config, dataset: { profile: 'custom', users: 2, postsPerUser: 1, likesPerUser: 1 } };
  const fixture = await seedFixture(custom, backend.factory, () => {});
  assert.equal(fixture.preparationMethod, 'sdk-bulk-per-user-v1');
  assert.deepEqual(backend.calls.map(c => [c.method, c.size]), Array.from({ length: 4 }, () => ['createBulk', 1]));
  assert.deepEqual([fixture.baseline.users, fixture.baseline.posts, fixture.baseline.likes], [2, 2, 2]);
});

test('private fixture files and directory are restricted and existing file is not clobbered on creation', () => {
  const root = mkdtempSync(join(tmpdir(), 'baas-private-'));
  const path = join(root, 'private', 'fixture.json');
  try {
    savePrivate(path, { status: 'pending' }, true);
    assert.equal(statSync(join(root, 'private')).mode & 0o777, 0o700);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.throws(() => savePrivate(path, { overwritten: true }, true), /EEXIST/);
    savePrivate(path, { status: 'ready' });
    assert.equal(JSON.parse(readFileSync(path)).status, 'ready');
  } finally { rmSync(root, { recursive: true }); }
});
