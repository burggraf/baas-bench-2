// esbuild keeps the supplied CommonJS loader lazy. Most TrailBase VUs never
// need the full parser. On first access install the actual constructor, so
// unusual URLs, static methods and SDK callers keep core-js's exact behavior.
export function installURLPolyfill(load, target = globalThis) {
  const previous = Object.getOwnPropertyDescriptor(target, 'URL');
  const set = value => Object.defineProperty(target, 'URL', {
    value, writable: true, configurable: true, enumerable: previous?.enumerable ?? true,
  });
  const deferred = {
    configurable: true, enumerable: previous?.enumerable ?? true, set,
    get() {
      // core-js inspects the native global during initialization; hide this
      // accessor to avoid recursion and preserve its feature detection.
      if (previous) Object.defineProperty(target, 'URL', previous);
      else delete target.URL;
      try {
        const URL = load();
        set(URL);
        return URL;
      } catch (error) {
        Object.defineProperty(target, 'URL', deferred);
        throw error;
      }
    },
  };
  Object.defineProperty(target, 'URL', deferred);
}

// Keep only the response fields used by the SDK; share methods across requests.
class TransportResponse {
  constructor(response) {
    this.status = response.status;
    this.ok = response.status >= 200 && response.status < 300;
    this.statusText = response.status_text;
    this.body = response.body ?? '';
  }
  async text() { return this.body; }
  async json() { return JSON.parse(this.body); }
}

// Only the fetch response subset exercised by TrailBase auth and Record APIs.
export function createTransport(baseUrl, request) {
  let origin;
  // Exact deployment origins are already canonical. All other inputs still
  // go through the full parser, including near matches and optional slashes.
  if (['http://trailbase:4000', 'http://pocketbase:4000', 'http://127.0.0.1:4000'].includes(baseUrl)) {
    origin = baseUrl;
  } else {
    let base;
    try { base = new URL(baseUrl); } catch { throw new Error('Invalid base URL'); }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
        base.pathname !== '/' || base.search || base.hash) {
      throw new Error('Expected an HTTP(S) origin as the base URL');
    }
    origin = base.origin;
  }
  const paths = new Map();
  return {
    async fetch(path, init = {}) {
      let target = typeof path === 'string' ? paths.get(path) : undefined;
      if (!target) {
        // A narrow canonical subset needs no URL normalization. Everything else
        // still uses the full URL parser and the existing same-origin checks.
        const query = typeof path === 'string' ? path.indexOf('?') : -1;
        const pathname = typeof path === 'string' ? (query < 0 ? path : path.slice(0, query)) : '';
        let href, normalizedPath;
        if (pathname.startsWith('/api/') && !/[^A-Za-z0-9_/-]/.test(pathname) &&
            (query < 0 || !/[^A-Za-z0-9_%=&+,.*!~()-]/.test(path.slice(query + 1)))) {
          href = origin + path;
          normalizedPath = pathname;
        } else {
          const url = new URL(path, origin);
          if (!path.startsWith('/api/') || url.origin !== origin || !url.pathname.startsWith('/api/')) {
            throw new Error('Expected a same-origin API path');
          }
          href = url.href;
          normalizedPath = url.pathname;
        }
        target = { href, name: normalizedPath.replace(/^(\/api\/records\/v1\/[^/]+)\/[^/]+$/, '$1/:id').replace(/^(\/api\/collections\/[^/]+\/records)\/[^/]+$/, '$1/:id') };
        // Bound retained URL metadata; never cache responses, credentials or mutable paths.
        if (typeof path === 'string') {
          if (paths.size === 32) paths.delete(paths.keys().next().value);
          paths.set(path, target);
        }
      }
      const response = await request(init.method ?? 'GET', target.href, init.body ?? null, {
        headers: init.headers ?? {}, timeout: '10s', redirects: 0, responseType: 'text', tags: { name: target.name },
      });
      if (response.status === 0) {
        throw new TypeError(`HTTP transport failed (k6 error ${response.error_code})`);
      }
      return new TransportResponse(response);
    },
  };
}
