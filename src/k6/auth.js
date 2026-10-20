import http from 'k6/http';
import encoding from 'k6/encoding';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import URL from 'core-js-pure/actual/url/index.js';
import URLSearchParams from 'core-js-pure/actual/url-search-params/index.js';
import { initClient } from 'trailbase';
import { createTransport } from './transport.js';
import { createAtob } from '../base64.js';
import { sessionValid } from '../auth.js';

globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
globalThis.atob = createAtob((value, format) => encoding.b64decode(value, format));
const config = JSON.parse(open('/config/run.json'));
const mode = __ENV.AUTH_CHECK_MODE;
if (!['natural', 'smoke'].includes(mode)) throw new Error('Explicit auth check mode required');
const users = new SharedArray('auth identities', () => {
  const fixture = JSON.parse(open('/private/fixture.json'));
  if (fixture.status !== 'used' || fixture.users.length !== config.dataset.users) throw new Error('Unauthorized fixture');
  return fixture.users;
});
const finished = new Counter('auth_check_finished'), verified = new Counter('auth_check_verified');
const natural = new Counter('auth_check_natural'), logins = new Counter('auth_check_logins');
const refreshes = new Counter('auth_check_refreshes'), afterExpiry = new Counter('auth_check_after_expiry');
const failed = new Rate('auth_check_failed'), ttl = new Trend('auth_check_ttl');
const elapsed = new Trend('auth_check_elapsed_seconds');
const evidence = new Trend('auth_check_session');
export const options = {
  scenarios: { auth: { executor: 'per-vu-iterations', vus: config.vus, iterations: 1, maxDuration: mode === 'natural' ? '65m' : '30s' } },
  thresholds: { auth_check_finished: [`count==${config.vus}`], auth_check_verified: [`count==${config.vus}`], auth_check_failed: ['rate==0'] },
  summaryTrendStats: ['min', 'max'],
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'error_code'],
};
const claims = client => {
  const decoded = JSON.parse(atob(client.tokens().auth_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
  return { iat: decoded.iat, exp: decoded.exp };
};
export default async function () {
  const user = users[exec.vu.idInTest - 1];
  const s = { refreshes: 0, firstRefreshAt: null, reads: 0, postExpiryReads: 0, failures: 0, identityValid: true, loggedOut: false };
  const started = exec.instance.currentTestRunDuration;
  const jar = new http.CookieJar();
  let logoutSucceeded = false;
  const request = async (method, url, body, params) => {
    const at = Date.now() / 1000;
    const result = await http.asyncRequest(method, url, body, { ...params, jar });
    const ok = result.status >= 200 && result.status < 300;
    failed.add(!ok); if (!ok) s.failures++;
    const operation = new URL(url).pathname;
    if (operation === '/api/auth/v1/refresh' && ok) {
      s.refreshes++; refreshes.add(1); s.firstRefreshAt ??= at;
    }
    if (operation === '/api/auth/v1/logout') logoutSucceeded = ok;
    return result;
  };
  const client = initClient(undefined, { transport: createTransport(__ENV.BASE_URL ?? 'http://trailbase:4000', request) });
  verified.add(0); natural.add(0); refreshes.add(0); afterExpiry.add(0);
  let originalToken;
  try {
    await client.login(user.username, user.password); logins.add(1);
    s.loginAt = Date.now() / 1000;
    s.initial = claims(client); originalToken = client.tokens().auth_token;
    if (s.initial.exp - s.initial.iat !== 3600 || Math.abs(s.loginAt - s.initial.iat) > 5) throw new Error('Unexpected native TTL/clock');
    ttl.add(s.initial.exp - s.initial.iat);
    const end = mode === 'natural' ? s.initial.exp + 30 : s.loginAt + 5;
    do {
      const result = await client.records('likes').list({ pagination: { limit: 100 }, count: true });
      s.identityValid &&= client.user()?.id === user.id;
      if (result.total_count !== user.likes.length || result.records.length !== user.likes.length ||
          result.records.some(row => row.user !== user.id || !user.likes.some(like => like.id === row.id && like.post === row.post))) throw new Error('Protected read mismatch');
      s.reads++;
      if (Date.now() / 1000 > s.initial.exp) { s.postExpiryReads++; afterExpiry.add(1); }
      if (Date.now() / 1000 >= end) break;
      sleep(Math.min(5, Math.max(0, end - Date.now() / 1000)));
    } while (exec.instance.currentTestRunDuration - started < 64 * 60 * 1000);
    s.final = claims(client); s.tokenChanged = originalToken !== client.tokens().auth_token;
    ttl.add(s.final.exp - s.final.iat);
  } catch {
    s.failures++; failed.add(true);
  } finally {
    try { await client.logout(); s.loggedOut = logoutSucceeded && !client.user(); }
    catch { s.failures++; failed.add(true); }
    s.endAt = Date.now() / 1000; s.elapsedSeconds = (exec.instance.currentTestRunDuration - started) / 1000;
    elapsed.add(s.elapsedSeconds); finished.add(1);
    const values = { ...s, initial_iat: s.initial?.iat, initial_exp: s.initial?.exp, final_iat: s.final?.iat, final_exp: s.final?.exp };
    delete values.initial; delete values.final;
    for (const [field, value] of Object.entries(values)) {
      evidence.add(typeof value === 'boolean' ? Number(value) : (Number.isFinite(value) ? value : -1), { vu: String(exec.vu.idInTest), field });
    }
    if (sessionValid(s, mode)) { verified.add(1); if (mode === 'natural') natural.add(1); }
    else failed.add(true);
  }
}
