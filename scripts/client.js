import { initClient } from 'trailbase';

// Fixed local pilot origin; do not repoint controller credentials at arbitrary services.
export function controllerClient(signal) {
  let logoutFailed = false;
  const client = initClient(undefined, { transport: { async fetch(path, init) {
    try {
      const response = await fetch(new URL(path, 'http://127.0.0.1:4000'), { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10000), signal]) });
      if (path.endsWith('/logout') && !response.ok) logoutFailed = true;
      return response;
    } catch (error) { if (path.endsWith('/logout')) logoutFailed = true; throw error; }
  } } });
  const logout = client.logout.bind(client);
  client.logout = async () => { signal.throwIfAborted(); logoutFailed = false; await logout(); if (logoutFailed) throw new Error('Native logout failed'); return true; };
  return client;
}
