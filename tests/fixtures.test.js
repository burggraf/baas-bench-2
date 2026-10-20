import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';

export function memoryClients() {
  const users = new Map(), posts = new Map(), likes = new Map();
  let sequence = 0, sessions = 0;
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
        return {
          async create(fields) { const id = `r${++sequence}`; rows.set(id, { id, ...fields, created_at: 1, updated_at: 1 }); return id; },
          async list(opts = {}) {
            const filtered = [...rows.values()].filter(row => (table !== 'likes' || row.user === user.id) && (opts.filters ?? []).every(f => row[f.column] === f.value));
            return { records: filtered.slice(0, opts.pagination?.limit ?? 20), ...(opts.count ? { total_count: filtered.length } : {}) };
          },
        };
      },
    };
  };
  return { factory, users, posts, likes, sessions: () => sessions };
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

test('partial seeds remain failed, keep credentials for cleanup, and cannot verify as a baseline', async () => {
  const backend = memoryClients();
  let saved;
  const factory = () => {
    const client = backend.factory();
    const records = client.records;
    client.records = table => ({ ...records(table), create: async () => { throw new Error('injected failure'); } });
    return client;
  };
  await assert.rejects(() => seedFixture(config, factory, f => { saved = structuredClone(f); }), /injected failure/);
  assert.equal(saved.status, 'failed');
  assert.ok(saved.users[0].password);
  assert.equal(backend.sessions(), 0);
  await assert.rejects(() => verifyFixture(config, saved, backend.factory), /ready/);
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
