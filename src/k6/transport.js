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
  let base;
  try { base = new URL(baseUrl); } catch { throw new Error('Invalid base URL'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Expected an HTTP(S) origin as the base URL');
  }
  const origin = base.origin;
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
          const url = new URL(path, base);
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
