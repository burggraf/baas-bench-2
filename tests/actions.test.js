import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { postFields } from '../src/workload.js';
import { performAction, initialState } from '../src/actions.js';

const config = JSON.parse(readFileSync('configs/smoke.json'));
function api() {
  const calls = [];
  const posts = [{ id: 'p1', author: 'u1', title: 'one', body: 'x'.repeat(1024), created_at: 1, updated_at: 1 }, { id: 'p2', author: 'u2', title: 'two', body: 'x'.repeat(1024), created_at: 1, updated_at: 1 }];
  const likes = [{ id: 'l1', user: 'u1', post: 'p2' }];
  let seq = 0;
  const client = { records(table) {
    const rows = table === 'posts' ? posts : likes;
    return {
      async list(opts = {}) { calls.push(`${table}.list`); return { records: rows.filter(r => (opts.filters ?? []).every(f => r[f.column] === f.value)).slice(0, opts.pagination?.limit ?? 20) }; },
      async read(id) { calls.push(`${table}.read`); return rows.find(r => r.id === id); },
      async create(fields) { calls.push(`${table}.create`); const id = `new${++seq}`; rows.push({ id, ...fields }); return id; },
      async update(id, fields) { calls.push(`${table}.update`); Object.assign(rows.find(r => r.id === id), fields); },
      async delete(id) { calls.push(`${table}.delete`); rows.splice(rows.findIndex(r => r.id === id), 1); },
    };
  } };
  return { client, calls, posts, likes };
}
const user = { id: 'u1', index: 0, posts: ['p1'], likes: [{ id: 'l1', post: 'p2' }] };

test('all seven actions make real SDK operations and mutations update only on success', async () => {
  const backend = api(), state = initialState(user, ['p1', 'p2'], config);
  for (const action of ['listPublic', 'listOwn', 'read', 'create', 'like', 'unlike', 'edit']) {
    const before = backend.calls.length;
    await performAction(backend.client, state, action, config, () => 0, () => {});
    assert.ok(backend.calls.length > before, action);
  }
  assert.ok(backend.posts.some(p => p.id === 'p1' && p.title !== 'one'));
  assert.ok(backend.posts.every(p => p.body.length === 1024));
  const failing = { records: () => ({ create: async () => { throw new Error('fail'); } }) };
  const before = JSON.stringify(state);
  await assert.rejects(() => performAction(failing, state, 'create', config, () => 0, () => {}), /fail/);
  assert.equal(JSON.stringify(state), before);
});

test('first edit cannot accidentally reproduce a seeded payload', async () => {
  const backend = api(), state = initialState(user, ['p1'], config);
  Object.assign(backend.posts[0], postFields(config, 0, 1));
  const before = backend.posts[0].body;
  await performAction(backend.client, state, 'edit', config, () => 0, () => {});
  assert.notEqual(backend.posts[0].body, before);
});

test('unlike fetches a real own target when cache is empty; no-target is a failure, not a substituted read', async () => {
  const backend = api(), state = initialState({ ...user, likes: [] }, [], config);
  let prerequisites = 0;
  await performAction(backend.client, state, 'unlike', config, () => 0, () => { prerequisites++; });
  assert.equal(prerequisites, 1);
  assert.deepEqual(backend.calls, ['likes.list', 'likes.delete']);
  await assert.rejects(() => performAction(backend.client, state, 'unlike', config, () => 0, () => {}), /unavailable_target/);
});

test('like checks native own-like state and advances a bounded feed page instead of duplicating', async () => {
  const backend = api(), state = initialState(user, ['p2'], config);
  await performAction(backend.client, state, 'like', config, () => 0, () => {});
  assert.equal(backend.likes.filter(l => l.post === 'p2').length, 1);
  assert.ok(backend.likes.some(l => l.post === 'p1'));
  assert.ok(backend.calls.includes('posts.list'));
});

test('like search wraps an exhausted offset and still scans past an already-liked first page', async () => {
  const backend = api(), state = initialState(user, ['p2'], config);
  state.offset = 100;
  const original = backend.client.records;
  backend.client.records = table => {
    const methods = original(table);
    if (table === 'posts') methods.list = async opts => {
      const offset = opts.pagination.offset;
      if (offset === 100) return { records: [] };
      if (!offset) return { records: [backend.posts[1]] };
      return { records: [backend.posts[0]] };
    };
    return methods;
  };
  await performAction(backend.client, state, 'like', config, () => 0, () => {});
  assert.ok(backend.likes.some(l => l.post === 'p1'));
});

for(const version of ['social-mixed-v1','social-prepared-v1'])test(`${version} like search progresses after a short feed page without changing legacy offsets`,async()=>{
  const c={...config,version},backend=api(),state=initialState(user,['p2'],c),offsets=[];
  const original=backend.client.records;
  backend.client.records=table=>{
    const methods=original(table);
    if(table==='posts')methods.list=async opts=>{
      const offset=opts.pagination.offset;offsets.push(offset);
      if(version==='social-prepared-v1')assert.equal(offset%c.pageSize,0,'Native page-based SDK requires aligned offsets');
      return {records:offset===c.pageSize?[backend.posts[1]]:offset>c.pageSize?[]:[backend.posts[0]]};
    };
    return methods;
  };
  await performAction(backend.client,state,'like',c,()=>0,()=>{});
  assert.deepEqual(offsets,[c.pageSize,version==='social-prepared-v1'?c.pageSize*2:c.pageSize+1,0]);
  assert.ok(backend.likes.some(l=>l.post==='p1'));
});

test('caches stay bounded and malformed/foreign records fail validation', async () => {
  const state = initialState({ ...user, posts: Array.from({ length: 200 }, (_, i) => `p${i}`), likes: Array.from({ length: 200 }, (_, i) => ({ id: `l${i}`, post: `p${i}` })) }, Array.from({ length: 200 }, (_, i) => `p${i}`), config);
  assert.ok(state.owned.length <= 100 && state.visible.length <= 100 && state.likes.length <= 100);
  const backend = api(); backend.posts[0].author = 'foreign';
  await assert.rejects(() => performAction(backend.client, state, 'listOwn', config, () => 0, () => {}), /invalid_response/);
});
