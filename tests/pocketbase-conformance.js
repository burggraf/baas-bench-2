import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export async function pocketbaseConformance(createClient) {
  const a = createClient(), b = createClient(), anon = createClient();
  const prefix = `conformance${randomBytes(8).toString('hex')}`, password = randomBytes(24).toString('base64url');
  await a.register({ username: `${prefix}a`, password }); await b.register({ username: `${prefix}b`, password });
  await a.login(`${prefix}a`, password); await b.login(`${prefix}b`, password);
  const owner = a.user().id, other = b.user().id;
  assert.notEqual(owner, other); assert.equal(anon.user(), null);
  await assert.rejects(anon.records('posts').create({ author: owner, title: 'x', body: 'x' }));
  await assert.rejects(b.records('posts').create({ author: owner, title: 'x', body: 'x' }));
  const post = await a.records('posts').create({ author: owner, title: 'title', body: 'x'.repeat(1024) });
  assert.equal((await anon.records('posts').read(post)).author, owner);
  assert.equal((await anon.records('posts').list({ pagination: { limit: 20 }, order: ['-created_at', '-id'] })).records[0].id, post);
  await assert.rejects(b.records('posts').update(post, { title: 'intrusion' }));
  await assert.rejects(b.records('posts').delete(post));
  await assert.rejects(a.records('posts').update(post, { author: other }));
  await a.records('posts').update(post, { title: 'edited' });
  assert.equal((await a.records('posts').read(post)).title, 'edited');
  const like = await a.records('likes').create({ user: owner, post });
  await assert.rejects(a.records('likes').create({ user: owner, post }));
  await assert.rejects(b.records('likes').create({ user: owner, post }));
  await assert.rejects(a.records('likes').create({ user: owner, post: 'missingpost0000' }));
  assert.equal((await b.records('likes').list({ pagination: { limit: 20 } })).records.length, 0);
  await assert.rejects(b.records('likes').read(like)); await assert.rejects(b.records('likes').delete(like));
  await a.refresh(); assert.equal(a.user().id, owner);
  await a.records('likes').delete(like);
  assert.equal((await a.records('likes').list({ pagination: { limit: 20 }, count: true })).total_count, 0);
  const ids = await a.records('posts').createBulk([{ author: owner, title: 'first', body: 'one' }, { author: owner, title: 'second', body: 'two' }]);
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]);
  assert.equal((await a.records('posts').read(ids[0])).title, 'first'); assert.equal((await a.records('posts').read(ids[1])).title, 'second');
  await assert.rejects(b.records('posts').createBulk([{ author: owner, title: 'forged', body: 'x' }]));
  await a.deleteUser(); await b.deleteUser();
  assert.equal((await anon.records('posts').list({ pagination: { limit: 1 }, count: true })).total_count, 0);
  return { passed: true, officialSdk: true, ownership: true, privateLikes: true, batchMapping: true, refresh: true, logout: 'client-token-clear; stateless native auth', apiCleanupPosts: 0 };
}
