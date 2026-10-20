import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdirSync, lstatSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { validateConfig, postFields } from './workload.js';

export function savePrivate(path, value, exclusive = false) {
  const directory = dirname(path);
  assert.notEqual(resolve(directory), process.cwd(), 'Use a dedicated private fixture directory');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parent = lstatSync(directory);
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && !(parent.mode & 0o077), 'Fixture directory must be private (0700)');
  if (existsSync(path)) {
    const file = lstatSync(path);
    assert.ok(file.isFile() && !file.isSymbolicLink() && !(file.mode & 0o077), 'Fixture file must be private (0600)');
  }
  const target = exclusive ? path : `${path}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(target, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  if (!exclusive) renameSync(target, path);
}

export async function seedFixture(config, createClient, persist) {
  validateConfig(config);
  const started = Date.now();
  const namespace = `bench${randomBytes(8).toString('hex')}`;
  const fixture = {
    version: 1, status: 'pending', namespace, config, startedAt: new Date(started).toISOString(),
    users: Array.from({ length: config.dataset.users }, (_, i) => ({
      index: i, username: `${namespace}${i}`, password: `${randomBytes(24).toString('base64url')}aA1!`, posts: [], likes: [],
    })),
  };
  persist(fixture);
  try {
    const count = await createClient().records('posts').list({ pagination: { limit: 1 }, count: true });
    assert.equal(count.total_count, 0, 'Seed only an empty, isolated benchmark deployment');
    // Concurrency one is intentional: deterministic logical order, no burst-hidden retries.
    for (const [i, user] of fixture.users.entries()) {
      const client = createClient();
      try {
        await client.register({ username: user.username, password: user.password });
        await client.login(user.username, user.password);
        assert.equal(client.user()?.username, user.username, 'Registered identity mismatch');
        user.id = client.user().id;
        for (let j = 0; j < config.dataset.postsPerUser; j++) {
          user.posts.push(await client.records('posts').create({ author: user.id, ...postFields(config, i, j) }));
        }
      } finally { if (client.user()) assert.ok(await client.logout(), 'Preparation logout failed'); }
    }
    const posts = fixture.users.flatMap(u => u.posts);
    for (const [i, user] of fixture.users.entries()) {
      const client = createClient();
      try {
        await client.login(user.username, user.password);
        for (let j = 0; j < config.dataset.likesPerUser; j++) {
          const post = posts[((i + 1) * config.dataset.postsPerUser + j) % posts.length];
          const id = await client.records('likes').create({ user: user.id, post });
          user.likes.push({ id, post });
        }
      } finally { if (client.user()) assert.ok(await client.logout(), 'Preparation logout failed'); }
    }
    fixture.status = 'ready';
    fixture.baseline = await verifyFixture(config, fixture, createClient);
    fixture.seedSeconds = (Date.now() - started) / 1000;
    fixture.visible = (await createClient().records('posts').list({ pagination: { limit: config.pageSize }, order: ['-created_at', '-id'] })).records.map(p => p.id);
    persist(fixture);
    return fixture;
  } catch (error) {
    fixture.status = 'failed';
    persist(fixture);
    throw error;
  }
}

export async function verifyFixture(config, fixture, createClient) {
  assert.equal(fixture.status, 'ready', 'Fixture must be ready, not partial or previously used');
  assert.deepEqual(fixture.config, config, 'Fixture configuration mismatch; reset/reseed');
  assert.equal(fixture.users.length, config.dataset.users);
  const ids = new Set(), logical = createHash('sha256');
  const postIds = fixture.users.flatMap(user => user.posts);
  assert.equal(new Set(postIds).size, config.dataset.users * config.dataset.postsPerUser, 'Duplicate/missing fixture posts');
  logical.update('api-verified-logical-baseline-v1\n');
  let posts = 0, likes = 0, minCreatedAt = Infinity, maxCreatedAt = -Infinity;
  for (const [i, user] of fixture.users.entries()) {
    const client = createClient();
    try {
      await client.login(user.username, user.password);
      assert.equal(user.index, i, 'Fixture logical index mismatch');
      assert.equal(client.user()?.id, user.id, 'Fixture identity mismatch');
      assert.equal(client.user()?.username, user.username, 'Fixture username mismatch');
      assert.ok(!ids.has(user.id), 'Duplicate fixture identity'); ids.add(user.id);
      logical.update(JSON.stringify(['user', i]) + '\n');
      const own = await client.records('posts').list({ pagination: { limit: 100 }, filters: [{ column: 'author', value: user.id }], count: true });
      assert.equal(own.total_count, config.dataset.postsPerUser);
      assert.equal(own.records.length, own.total_count);
      for (const [j, id] of user.posts.entries()) {
        const post = own.records.find(p => p.id === id);
        assert.ok(post && post.author === user.id, 'Post ownership/ID mismatch');
        const fields = postFields(config, i, j);
        assert.equal(post.title, fields.title); assert.equal(post.body, fields.body);
        logical.update(JSON.stringify(['post', i, j, post.title, post.body]) + '\n');
        assert.ok(Number.isInteger(post.created_at) && Number.isInteger(post.updated_at));
        minCreatedAt = Math.min(minCreatedAt, post.created_at); maxCreatedAt = Math.max(maxCreatedAt, post.created_at);
      }
      assert.equal(user.posts.length, config.dataset.postsPerUser);
      const ownLikes = await client.records('likes').list({ pagination: { limit: 100 }, count: true });
      assert.equal(ownLikes.total_count, config.dataset.likesPerUser);
      assert.equal(ownLikes.records.length, ownLikes.total_count);
      assert.equal(user.likes.length, config.dataset.likesPerUser);
      assert.equal(new Set(user.likes.map(l => l.post)).size, user.likes.length);
      for (const [j, like] of user.likes.entries()) {
        assert.ok(ownLikes.records.some(l => l.id === like.id && l.post === like.post && l.user === user.id), 'Like ownership/ID mismatch');
        const target = ((i + 1) * config.dataset.postsPerUser + j) % postIds.length;
        assert.equal(like.post, postIds[target], 'Like recipe mismatch');
        logical.update(JSON.stringify(['like', i, target]) + '\n');
      }
      posts += own.records.length; likes += ownLikes.records.length;
    } finally { if (client.user()) assert.ok(await client.logout(), 'Verification logout failed'); }
  }
  const global = await createClient().records('posts').list({ pagination: { limit: 1 }, count: true });
  assert.equal(global.total_count, posts, 'Unexpected public data in benchmark deployment');
  return { users: ids.size, posts, likes, minCreatedAt, maxCreatedAt, timestampUnit: 'seconds', retries: 0, logicalHash: logical.digest('hex') };
}

export async function deleteFixture(fixture, createClient, persist = () => {}) {
  assert.ok(['ready', 'used', 'deleting'].includes(fixture.status), 'Partial seed: reset the isolated deployment before reseeding');
  assert.match(fixture.namespace, /^bench[0-9a-f]{16}$/);
  // Preflight all identities before deleting any; resume skips already-deleted accounts.
  for (const [i, user] of fixture.users.entries()) {
    assert.equal(user.username, `${fixture.namespace}${i}`, 'Refuse unrelated account');
    if (user.deleted) continue;
    const client = createClient();
    try {
      await client.login(user.username, user.password);
      assert.equal(client.user()?.id, user.id, 'Refuse deletion: fixture identity mismatch');
    } finally { if (client.user()) assert.ok(await client.logout()); }
  }
  fixture.status = 'deleting'; persist(fixture);
  for (const user of fixture.users) {
    if (user.deleted) continue;
    const client = createClient();
    try {
      await client.login(user.username, user.password);
      assert.equal(client.user()?.id, user.id, 'Refuse deletion: fixture identity mismatch');
      await client.deleteUser();
      user.deleted = true; persist(fixture);
    } finally { if (client.user()) await client.logout(); }
  }
  fixture.status = 'deleted'; persist(fixture);
}
