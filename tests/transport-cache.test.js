import assert from 'node:assert/strict';
import { test } from 'node:test';
import PolyfillURL from 'core-js-pure/actual/url/index.js';
import { createTransport } from '../src/k6/transport.js';

for (const URLClass of [globalThis.URL, PolyfillURL]) {
  test(`reuses only the last validated path metadata (${URLClass === PolyfillURL ? 'k6 polyfill' : 'native'})`, async () => {
    const originalURL = globalThis.URL;
    let parses = 0;
    globalThis.URL = class extends URLClass { constructor(...args) { super(...args); parses++; } };
    try {
      const calls = [];
      const transport = createTransport('http://backend:4000', async (...args) => {
        calls.push(args);
        return { status: calls.length === 2 ? 403 : 200, body: JSON.stringify({ request: calls.length }) };
      });
      const path = '/api/records/v1/posts?limit=20';
      const first = await transport.fetch(path, { headers: { Authorization: 'Bearer first-test' } });
      const second = await transport.fetch(path, { method: 'POST', body: 'new body', headers: { Authorization: 'Bearer second-test' } });
      assert.equal(parses, 2, 'base plus one path parse; repeated requests still reach the server');
      assert.equal(calls.length, 2);
      assert.equal(first.status, 200);
      assert.equal(second.status, 403);
      assert.deepEqual(await first.json(), { request: 1 });
      assert.deepEqual(await second.json(), { request: 2 });
      assert.equal(calls[1][0], 'POST');
      assert.equal(calls[1][2], 'new body');
      assert.deepEqual(calls[1][3].headers, { Authorization: 'Bearer second-test' });
      for (const bad of ['//external/api/records/v1/posts', 'https://external/api/records/v1/posts', '/api/../private', '/api/..\\..\\private', '/api/./../../private']) {
        await assert.rejects(transport.fetch(bad), /API path/);
      }
      assert.equal(calls.length, 2, 'invalid paths must not receive credentials, even with a populated cache');
      const afterRejections = parses;
      await transport.fetch(path);
      assert.equal(parses, afterRejections, 'rejected paths must not replace the validated entry');
      await transport.fetch('/api/records/v1/posts/record-id?expand=author');
      await transport.fetch(path);
      assert.equal(parses, afterRejections + 2, 'a different path is validated and evicts the single old entry');
      assert.equal(calls.at(-2)[3].tags.name, '/api/records/v1/posts/:id');
      assert.equal(calls.at(-1)[3].tags.name, '/api/records/v1/posts');
      const other = createTransport('http://other:4000', async (_method, url) => {
        assert.equal(url, 'http://other:4000/api/records/v1/posts?limit=20');
        return { status: 200, body: '{}' };
      });
      await other.fetch(path);
    } finally {
      globalThis.URL = originalURL;
    }
  });
}

test('mutable path objects cannot reuse metadata from an earlier coercion', async () => {
  let text = '/api/records/v1/posts', sends = 0;
  const path = { toString: () => text, startsWith: prefix => text.startsWith(prefix) };
  const transport = createTransport('http://backend:4000', async () => { sends++; return { status: 200 }; });
  await transport.fetch(path);
  text = '//external/api/records/v1/posts';
  await assert.rejects(transport.fetch(path), /API path/);
  assert.equal(sends, 1);
});
