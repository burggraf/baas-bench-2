import { initClient } from 'trailbase';

// Fixed local pilot origin; do not repoint controller credentials at arbitrary services.
export function controllerClient(signal, onRequest) {
  let logoutFailed = false;
  const client = initClient(undefined, { transport: { async fetch(path, init) {
    const url = new URL(path, 'http://127.0.0.1:4000'), began = performance.now(), startedAt = new Date().toISOString();
    let status = null;
    const record = (stage, error, bodyMethod) => {
      if (!onRequest) return;
      const match = url.pathname.match(/^\/api\/records\/v1\/(posts|likes)(\/[^/]+)?$/);
      const route = match ? `/api/records/v1/${match[1]}${match[2] ? '/:id' : ''}` : /^\/api\/auth\/v1\/(register|login|logout|refresh|delete)$/.test(url.pathname) || url.pathname === '/api/healthcheck' ? url.pathname : '/api/other';
      const method = init?.method ?? 'GET';
      const row = { at: new Date().toISOString(), startedAt, route, method: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(method) ? method : 'OTHER', stage, status, timeoutMs: 10000, durationMs: performance.now() - began, ...(bodyMethod ? { bodyMethod } : {}), ...(error ? { errorType: ['TimeoutError', 'AbortError', 'TypeError', 'SyntaxError', 'Error'].includes(error.name) ? error.name : 'Error' } : {}) };
      if (error && typeof error === 'object' && Object.isExtensible(error)) error.controllerRequest = row;
      onRequest(row);
    };
    record('request');
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10000), signal]) });
      status = response.status;
      if (path.endsWith('/logout') && !response.ok) logoutFailed = true;
      record('headers');
      // fetch resolves at headers; body parsing can still hit the same request deadline.
      if (onRequest) for (const method of ['text', 'json']) {
        const consume = response[method].bind(response);
        response[method] = async () => {
          let value;
          try { value = await consume(); }
          catch (error) { record('error', error, method); throw error; }
          record('body', undefined, method);
          return value;
        };
      }
      return response;
    } catch (error) { if (path.endsWith('/logout')) logoutFailed = true; record('error', error); throw error; }
  } } });
  const logout = client.logout.bind(client);
  client.logout = async () => { signal.throwIfAborted(); logoutFailed = false; await logout(); if (logoutFailed) throw new Error('Native logout failed'); return true; };
  return client;
}
