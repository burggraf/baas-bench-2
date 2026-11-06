import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTransport } from '../src/k6/transport.js';

// Force core-js's own parser; under Node its normal export reuses native URL.
const NativeURL = globalThis.URL;
let PolyfillURL;
try {
  globalThis.URL = undefined;
  PolyfillURL = (await import('core-js-pure/actual/url/index.js')).default;
} finally { globalThis.URL = NativeURL; }
assert.notEqual(PolyfillURL, NativeURL);

for (const URLClass of [globalThis.URL, PolyfillURL]) {
  test(`canonical SDK paths avoid parsing without changing requests (${URLClass === PolyfillURL ? 'polyfill' : 'native'})`, async () => {
    const original = globalThis.URL;
    let parses = 0;
    globalThis.URL = class extends URLClass { constructor(...args) { super(...args); parses++; } };
    try {
      const calls = [], base = 'http://BACKEND:80';
      const transport = createTransport(base, async (...args) => { calls.push(args); return { status: 200, body: '{}' }; });
      const paths = ['/api/auth/login', '/api/records/v1/posts?limit=20&order=-created_at%2C-id',
        '/api/records/v1/likes?filter%5Bpost%5D%5B%24eq%5D=record-id',
        '/api/a?', '/api/a?x=%zz&x=(a)*!~.-_+&x=%20', '/api//a'];
      for (let i = 0; i < 100; i++) paths.push('/api/records/v1/posts/record-' + i);
      for (const path of paths) {
        await transport.fetch(path, { method: 'POST', body: 'new body', headers: { Authorization: 'Bearer current-test' } });
        const call = calls.at(-1), expected = new URLClass(path, base);
        assert.equal(call[1], expected.href);
        assert.equal(call[0], 'POST'); assert.equal(call[2], 'new body');
        assert.deepEqual(call[3].headers, { Authorization: 'Bearer current-test' });
        assert.equal(call[3].tags.name, expected.pathname.replace(/^(\/api\/records\/v1\/[^/]+)\/[^/]+$/, '$1/:id'));
      }
      assert.equal(parses, 1, 'only the origin needs parsing, even after cache eviction');
      assert.equal(calls.length, paths.length);
    } finally { globalThis.URL = original; }
  });

  test(`unusual paths retain URL normalization and origin protection (${URLClass === PolyfillURL ? 'polyfill' : 'native'})`, async () => {
    const original = globalThis.URL; globalThis.URL = URLClass;
    try {
      for (const base of ['http://backend:4000', 'https://backend:443/', 'http://[::1]:4000']) {
        const calls = [], transport = createTransport(base, async (...args) => { calls.push(args); return { status: 200 }; });
        for (const path of ['/api/records/./v1/posts', '/api/a%2Fb', '/api/☃', '/api/a?x=one\'two',
          '/api/a?x=hello world', '/api/a?x=☃', '/api/a?x=one?two', '/api/a#fragment',
          '/api/a\\b', '/api/a\n', '/api/a?x=1\n', '/api/a\0?x=3']) {
          await transport.fetch(path);
          assert.equal(calls.at(-1)[1], new URLClass(path, base).href, path);
        }
        const before = calls.length;
        for (const path of ['//other/api/a', 'https://other/api/a', '/api/../private',
          '/api/%2e%2e/private', '/api/%2E/%2e%2e/../private', '/api/..\\..\\private']) {
          await assert.rejects(transport.fetch(path), /API path/);
        }
        assert.equal(calls.length, before, 'rejected paths never send credentials');
      }
    } finally { globalThis.URL = original; }
  });
}
