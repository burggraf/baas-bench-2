// Only the fetch response subset exercised by TrailBase auth and Record APIs.
export function createTransport(baseUrl, request) {
  let base;
  try { base = new URL(baseUrl); } catch { throw new Error('Invalid base URL'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Expected an HTTP(S) origin as the base URL');
  }
  let previous;
  return {
    async fetch(path, init = {}) {
      let target = previous?.path === path ? previous : undefined;
      if (!target) {
        const url = new URL(path, base);
        if (!path.startsWith('/api/') || url.origin !== base.origin || !url.pathname.startsWith('/api/')) {
          throw new Error('Expected a same-origin API path');
        }
        target = { path, href: url.href, name: url.pathname.replace(/^(\/api\/records\/v1\/[^/]+)\/[^/]+$/, '$1/:id').replace(/^(\/api\/collections\/[^/]+\/records)\/[^/]+$/, '$1/:id') };
        // Mutable objects must be revalidated; retain at most one immutable path per client.
        if (typeof path === 'string') previous = target;
      }
      const response = await request(init.method ?? 'GET', target.href, init.body ?? null, {
        headers: init.headers ?? {}, timeout: '10s', redirects: 0, responseType: 'text', tags: { name: target.name },
      });
      if (response.status === 0) {
        throw new TypeError(`HTTP transport failed (k6 error ${response.error_code})`);
      }
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.status_text,
        async text() { return response.body ?? ''; },
        async json() { return JSON.parse(response.body ?? ''); },
      };
    },
  };
}
