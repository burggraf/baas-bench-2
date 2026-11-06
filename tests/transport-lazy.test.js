import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTransport, installURLPolyfill } from '../src/k6/transport.js';

const NativeURL = globalThis.URL;
let PolyfillURL;
try {
  globalThis.URL = undefined;
  PolyfillURL = (await import('core-js-pure/actual/url/index.js')).default;
} finally { globalThis.URL = NativeURL; }
assert.notEqual(PolyfillURL, NativeURL);

test('deferred URL installation exposes the actual complete constructor once', () => {
  for (const original of [undefined, NativeURL]) {
    const target = original ? { URL: original } : {};
    let loads = 0;
    installURLPolyfill(() => {
      loads++;
      assert.equal(target.URL, original, 'loader sees original global, without recursive access');
      return PolyfillURL;
    }, target);
    assert.equal(loads, 0);
    const url = new target.URL('/a?x=1', 'https://example.com');
    assert.equal(loads, 1);
    assert.equal(target.URL, PolyfillURL);
    assert.ok(url instanceof target.URL);
    url.searchParams.set('x', 'snow ☃');
    assert.equal(url.href, 'https://example.com/a?x=snow+%E2%98%83');
    assert.equal(target.URL.canParse('not a URL'), false);
    assert.equal(target.URL.parse('https://example.com').origin, 'https://example.com');
    class DerivedURL extends target.URL {}
    assert.ok(new DerivedURL('https://example.com') instanceof DerivedURL);
    assert.equal(loads, 1);
  }
});

test('failed lazy initialization can retry, and explicit assignment replaces it', () => {
  const target = {};
  let loads = 0;
  installURLPolyfill(() => {
    if (++loads === 1) throw new Error('initialization failed');
    return PolyfillURL;
  }, target);
  assert.throws(() => target.URL, /initialization failed/);
  assert.equal(target.URL, PolyfillURL);
  assert.equal(loads, 2);
  installURLPolyfill(() => assert.fail('assignment must not load the parser'), target);
  target.URL = NativeURL;
  assert.equal(target.URL, NativeURL);
});

for (const URLClass of [NativeURL, PolyfillURL]) {
  test(`known deployment origins defer parsing without weakening validation (${URLClass === NativeURL ? 'native' : 'polyfill'})`, async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'URL');
    let loads = 0;
    try {
      installURLPolyfill(() => { loads++; return URLClass; });
      const calls = [];
      for (const origin of ['http://trailbase:4000', 'http://pocketbase:4000', 'http://127.0.0.1:4000']) {
        const transport = createTransport(origin, async (...args) => { calls.push(args); return { status: 200 }; });
        for (const path of ['/api/auth/v1/login', '/api/auth/v1/refresh', '/api/auth/v1/logout', '/api/records/v1/posts?order=-created_at%2C-id', '/api/records/v1/posts/record-1']) {
          await transport.fetch(path, { headers: { Authorization: 'Bearer synthetic' } });
          assert.equal(calls.at(-1)[1], new URLClass(path, origin).href);
        }
      }
      assert.equal(loads, 0, 'canonical traffic does not load the full parser');
      const transport = createTransport('http://trailbase:4000', async (...args) => { calls.push(args); return { status: 200 }; });
      for (const path of ['/api/a/../b', '/api/☃?x=one two', '/api/a#hash', '/api/a\\b']) {
        await transport.fetch(path);
        assert.equal(calls.at(-1)[1], new URLClass(path, 'http://trailbase:4000').href);
      }
      assert.equal(loads, 1);
      const before = calls.length;
      for (const path of ['//external/api/auth', 'https://external/api/auth', '/api/../private', '/api/%2e%2e/private', '/api/..\\..\\private']) {
        await assert.rejects(transport.fetch(path), /API path/);
      }
      for (const base of ['http://trailbase:4000@external/private', 'http://trailbase:4000/api/', 'http://trailbase:4000?x=1', 'http://trailbase:4000/#hash', 'ftp://trailbase:4000']) {
        assert.throws(() => createTransport(base, () => assert.fail('must not send')), /base URL/);
      }
      assert.equal(calls.length, before);
      assert.equal(loads, 1);
    } finally { Object.defineProperty(globalThis, 'URL', original); }
  });
}
