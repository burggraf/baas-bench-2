import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initClient, FetchError } from 'trailbase';
import { createTransport } from '../src/k6/transport.js';

const response = (status, body = '', headers = {}) => ({ status, body, headers, status_text: 'Test status' });

test('forwards SDK method, JSON body and auth headers with a bounded timeout', async () => {
  const calls = [];
  const transport = createTransport('http://backend:4000/', async (...args) => {
    calls.push(args);
    return response(201, '{"ids":[7]}');
  });
  const result = await transport.fetch('/api/records/v1/posts', {
    method: 'POST', body: '{"title":"hello"}', headers: { Authorization: 'Bearer test' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { ids: [7] });
  assert.equal(await result.text(), '{"ids":[7]}');
  const [method, url, body, params] = calls[0];
  assert.equal(method, 'POST');
  assert.equal(url, 'http://backend:4000/api/records/v1/posts');
  assert.equal(body, '{"title":"hello"}');
  assert.deepEqual(params.headers, { Authorization: 'Bearer test' });
  assert.equal(params.timeout, '10s');
  assert.equal(params.redirects, 0);
  assert.equal(params.responseType, 'text');
});

test('normalizes record IDs and query strings out of metric names', async () => {
  const names = [];
  const transport = createTransport('http://backend:4000', async (_m, _u, _b, params) => {
    names.push(params.tags.name);
    return response(200, '{}');
  });
  await transport.fetch('/api/records/v1/posts/secret-id?expand=author');
  await transport.fetch('/api/records/v1/posts?filter[author]=private-user');
  assert.deepEqual(names, ['/api/records/v1/posts/:id', '/api/records/v1/posts']);
});

test('keeps HTTP errors available for the official SDK to classify', async () => {
  const client = initClient(undefined, { transport: createTransport('http://backend:4000', async () => response(403, 'Forbidden')) });
  await assert.rejects(client.records('posts').read(7), error => error instanceof FetchError && error.status === 403);
});

test('adapts empty responses without manufacturing JSON', async () => {
  const transport = createTransport('http://backend:4000', async () => response(204));
  const result = await transport.fetch('/api/records/v1/likes/7', { method: 'DELETE' });
  assert.equal(result.ok, true);
  assert.equal(await result.text(), '');
  await assert.rejects(result.json(), SyntaxError);
});

test('rejects malformed JSON instead of silently marking it successful', async () => {
  const transport = createTransport('http://backend:4000', async () => response(200, 'not json'));
  await assert.rejects((await transport.fetch('/api/records/v1/posts')).json(), SyntaxError);
});

test('rejects timeouts/network failures without disclosing payloads or credentials', async () => {
  const transport = createTransport('http://backend:4000', async () => ({ status: 0, error_code: 1050, error: 'may contain private URL' }));
  await assert.rejects(transport.fetch('/api/records/v1/posts'), { message: 'HTTP transport failed (k6 error 1050)' });
});

test('does not follow redirects or count them as successful responses', async () => {
  const transport = createTransport('http://backend:4000', async () => response(302));
  assert.equal((await transport.fetch('/api/auth/v1/login')).ok, false);
});

test('rejects invalid base URLs and out-of-origin paths before sending credentials', async () => {
  for (const base of ['ftp://backend', 'http://user:password@backend', 'http://backend/path', 'http://backend?x=1']) {
    assert.throws(() => createTransport(base, () => assert.fail('must not send')), /base URL/);
  }
  const transport = createTransport('http://backend:4000', () => assert.fail('must not send'));
  for (const path of ['//external/api/auth', 'https://external/api/auth', '/api/../private']) {
    await assert.rejects(transport.fetch(path), /API path/);
  }
});
