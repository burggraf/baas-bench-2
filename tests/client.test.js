import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerClient } from '../scripts/client.js';

function useFetch(t, implementation) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => { globalThis.fetch = original; });
}
const safeTrace = rows => {
  for (const row of rows) {
    assert.ok(Number.isFinite(Date.parse(row.at)));
    assert.ok(Number.isFinite(row.durationMs) && row.durationMs >= 0);
    assert.equal(row.timeoutMs, 10000);
  }
  assert.doesNotMatch(JSON.stringify(rows), /private-user|private-post|private-password|private-token|private-response|private-error/);
};

test('controller diagnostics identify SDK routes and header/body timings without queries, IDs or credentials', async t => {
  const rows = [], signal = new AbortController().signal;
  useFetch(t, async (url, init) => {
    assert.equal(url.origin, 'http://127.0.0.1:4000');
    assert.equal(init.redirect, 'error');assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ records: [], total_count: 0 }), { status: 200 });
  });
  const client = controllerClient(signal, row => rows.push(row));
  await client.records('posts').list({ filters: [{ column: 'author', value: 'private-user' }], count: true });
  assert.deepEqual(rows.map(r => r.stage), ['request', 'headers', 'body']);
  assert.ok(rows.every(r => r.route === '/api/records/v1/posts' && r.method === 'GET'));
  assert.equal(rows.at(-1).status, 200);safeTrace(rows);
});

test('controller diagnostics retain the original failed request identity and never retry or log SDK payloads/errors', async t => {
  const rows = [], error = new DOMException('private-error private-password', 'TimeoutError');let calls = 0;
  useFetch(t, async () => { calls++;throw error; });
  const client = controllerClient(new AbortController().signal, row => rows.push(row));
  await assert.rejects(client.records('likes').create({ user: 'private-user', post: 'private-post' }), failure => failure === error);
  assert.equal(calls, 1);
  assert.deepEqual(rows.map(r => r.stage), ['request', 'error']);
  assert.equal(rows.at(-1).route, '/api/records/v1/likes');
  assert.equal(rows.at(-1).errorType, 'TimeoutError');assert.equal(rows.at(-1).status, null);
  assert.deepEqual(error.controllerRequest, rows.at(-1));safeTrace(rows);
});

test('a response-body timeout after successful headers is traced as an error, not a completed SDK read', async t => {
  const rows = [], error = new DOMException('private-response private-token', 'TimeoutError');
  useFetch(t, async () => new Response(new ReadableStream({ start(controller) { setTimeout(() => controller.error(error), 0); } }), { status: 200 }));
  const client = controllerClient(new AbortController().signal, row => rows.push(row));
  await assert.rejects(client.records('posts').read('private-post'), failure => failure === error);
  assert.deepEqual(rows.map(r => r.stage), ['request', 'headers', 'error']);
  assert.equal(rows.at(-1).route, '/api/records/v1/posts/:id');
  assert.equal(rows.at(-1).bodyMethod, 'text');assert.equal(rows.at(-1).status, 200);
  assert.equal(rows.at(-1).errorType, 'TimeoutError');safeTrace(rows);
});

test('SDK login JSON body failures are traced without disclosing authentication responses', async t => {
  const rows = [];
  useFetch(t, async () => new Response('private-response', { status: 200 }));
  const client = controllerClient(new AbortController().signal, row => rows.push(row));
  await assert.rejects(client.login('private-user', 'private-password'), SyntaxError);
  assert.deepEqual(rows.map(r => r.stage), ['request', 'headers', 'error']);
  assert.equal(rows.at(-1).route, '/api/auth/v1/login');
  assert.equal(rows.at(-1).bodyMethod, 'json');assert.equal(rows.at(-1).errorType, 'SyntaxError');safeTrace(rows);
});

test('unknown paths and exception names cannot inject private values into controller diagnostic metadata', async t => {
  const rows = [], error = Object.assign(new Error('private-error'), { name: 'private-token' });
  useFetch(t, async () => { throw error; });
  const client = controllerClient(new AbortController().signal, row => rows.push(row));
  await assert.rejects(client.fetch('/api/private-user?token=private-token', { method: 'private-password' }));
  assert.equal(rows.length, 2, 'the failed request must emit start and error diagnostics');
  assert.ok(rows.every(r => r.route === '/api/other' && r.method === 'OTHER'));
  assert.equal(rows.at(-1).errorType, 'Error');safeTrace(rows);
});

test('the native health route is identifiable without exposing arbitrary API paths', async t => {
  const rows = [];
  useFetch(t, async () => new Response('ok'));
  await (await controllerClient(new AbortController().signal, row => rows.push(row)).fetch('/api/healthcheck')).text();
  assert.deepEqual(rows.map(r => r.stage), ['request', 'headers', 'body']);
  assert.ok(rows.every(r => r.route === '/api/healthcheck'));safeTrace(rows);
});

test('without an observer the controller preserves its native Response and existing redirect/deadline behavior', async t => {
  const response = new Response('private-response');
  useFetch(t, async (_url, init) => { assert.equal(init.redirect, 'error');assert.ok(init.signal instanceof AbortSignal);return response; });
  const client = controllerClient(new AbortController().signal);
  assert.equal(await client.fetch('/api/records/v1/posts'), response);
  assert.equal(await response.text(), 'private-response');
});
