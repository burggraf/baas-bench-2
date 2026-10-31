import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../src/pocketbase.js');
test('PocketBase adapter uses official SDK, isolated auth and native logout/refresh', async () => {
  const { pocketbaseClient } = await load();
  const calls = [];
  const token = `e30.${Buffer.from(JSON.stringify({ id: 'alice', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.signature`;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ token, record: { id: 'alice', username: 'alice' } }), { status: 200 });
  };
  const a = pocketbaseClient('http://127.0.0.1:4000', fetch), b = pocketbaseClient('http://127.0.0.1:4000', fetch);
  await a.login('alice', 'test-password');
  assert.equal(a.user().id, 'alice'); assert.equal(b.user(), null);
  assert.equal(a.tokens().auth_token, token);
  await a.refresh(); assert.match(calls.at(-1).url, /\/users\/auth-refresh$/);
  const before = calls.length;
  assert.equal(await a.logout(), true); assert.equal(a.user(), null); assert.equal(calls.length, before);
  await assert.rejects(a.login('alice', 'test-password', 'extra').then(() => a.records('unknown').read('id')), /collection/);
});

test('PocketBase list maps fields, bounded offset, filters, totals and SDK writes', async () => {
  const { pocketbaseClient } = await load();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(JSON.stringify(init.method === 'POST' ? { id: 'newid' } : {
      items: [{ id: 'postid', author: 'alice', title: 'title', body: 'body', created: '2026-01-01 00:00:00.000Z', updated: '2026-01-01 00:00:01.000Z' }], totalItems: 9,
    }));
  };
  const client = pocketbaseClient('http://127.0.0.1:4000', fetch);
  const page = await client.records('posts').list({ pagination: { limit: 20, offset: 40 }, order: ['-created_at', '-id'], filters: [{ column: 'author', value: 'alice' }] });
  assert.equal(page.records[0].created_at, 1767225600); assert.equal(page.records[0].updated_at, 1767225601);
  assert.ok(!('total_count' in page));
  assert.equal(calls.at(-1).url.searchParams.get('page'), '3');
  assert.equal(calls.at(-1).url.searchParams.get('sort'), '-created,-id');
  assert.equal(calls.at(-1).url.searchParams.get('skipTotal'), 'true');
  assert.match(calls.at(-1).url.searchParams.get('filter'), /author.*alice/);
  assert.equal((await client.records('posts').list({ pagination: { limit: 1 }, count: true })).total_count, 9);
  assert.equal(await client.records('posts').create({ title: 't' }), 'newid');
  await assert.rejects(client.records('posts').list({ pagination: { limit: 20, offset: 1 } }), /offset/);
  await assert.rejects(client.records('posts').list({ filters: [{ column: 'arbitrary', value: 'x' }] }), /filter/);
});

test('PocketBase adapter rejects cross-origin SDK traffic and validates bulk responses', async () => {
  const { pocketbaseClient } = await load();
  let sent = 0;
  const client = pocketbaseClient('http://127.0.0.1:4000', async () => {
    sent++; return new Response(JSON.stringify([{ status: 200, body: { id: 'one' } }, { status: 400, body: {} }]));
  });
  await assert.rejects(client.records('posts').createBulk([{title:'a'}, {title:'b'}]), /batch/);
  assert.equal(sent, 1);
  assert.throws(() => pocketbaseClient('https://example.org', () => {}), /origin/);
});

test('PocketBase staged plan advances only on a valid pass and never retries', async () => {
  const { pocketbasePlan, nextPocketbasePoint } = await import('../scripts/pocketbase.js');
  assert.deepEqual(pocketbasePlan([]).points, [1000, 1500, 2000]);
  assert.deepEqual(pocketbasePlan(['--smoke']).points, [2]);
  assert.throws(() => pocketbasePlan(['--vus=2000']), /Usage/);
  assert.equal(nextPocketbasePoint([], [1000, 1500, 2000]), 1000);
  assert.equal(nextPocketbasePoint([{vus:1000, verdict:'pass'}], [1000, 1500, 2000]), 1500);
  for (const verdict of ['slo_failure', 'invalid', 'generator_limited']) assert.equal(nextPocketbasePoint([{vus:1000, verdict}], [1000,1500,2000]), null);
  assert.throws(() => nextPocketbasePoint([{vus:1500, verdict:'pass'}], [1000,1500,2000]), /order/);
});

test('PocketBase lower-load plan uses the full baseline and runs 500 only after 100 passes', async () => {
  const { pocketbasePlan, nextPocketbasePoint } = await import('../scripts/pocketbase.js');
  const plan = pocketbasePlan(['--lower']);
  assert.deepEqual(plan, { points: [100, 500], smoke: false });
  assert.equal(nextPocketbasePoint([], plan.points), 100);
  assert.equal(nextPocketbasePoint([{vus:100, verdict:'pass'}], plan.points), 500);
  assert.equal(nextPocketbasePoint([{vus:100, verdict:'pass'}, {vus:500, verdict:'pass'}], plan.points), null);
  for (const verdict of ['slo_failure', 'invalid', 'generator_limited']) {
    assert.equal(nextPocketbasePoint([{vus:100, verdict}], plan.points), null);
    assert.equal(nextPocketbasePoint([{vus:100, verdict:'pass'}, {vus:500, verdict}], plan.points), null);
  }
  for (const history of [[{vus:500, verdict:'pass'}], [{vus:100, verdict:'pass'}, {vus:100, verdict:'pass'}]]) assert.throws(() => nextPocketbasePoint(history, plan.points), /order/);
  for (const args of [['--lower','--smoke'], ['--lower','--lower'], ['--points=100,500']]) assert.throws(() => pocketbasePlan(args), /Usage/);
});
