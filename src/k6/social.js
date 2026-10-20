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
import { actions, validateConfig, random, chooseAction } from '../workload.js';
import { initialState, performAction } from '../actions.js';

globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
globalThis.atob = createAtob((value, format) => encoding.b64decode(value, format));
const config = validateConfig(JSON.parse(open('/config/run.json')));
const users = new SharedArray('identities', () => {
  const fixture = JSON.parse(open('/private/fixture.json'));
  if (fixture.status !== 'used' || fixture.users.length !== config.dataset.users) throw new Error('Unauthorized fixture');
  return fixture.users;
});
const visible = new SharedArray('visible posts', () => JSON.parse(open('/private/fixture.json')).visible);
const requested = new Counter('action_requested'), completed = new Counter('action_completed');
const failed = new Counter('action_failed'), duration = new Trend('action_duration', true);
const failureRate = new Rate('logical_failed'), prerequisites = new Counter('prerequisite_calls');
const unavailable = new Counter('target_unavailable'), invalid = new Counter('invalid_responses');
const errors = new Counter('action_errors'), finished = new Counter('users_finished');
const logins = new Counter('auth_login_count'), authDuration = new Trend('auth_duration', true);
const authFailed = new Rate('auth_failed'), authHttp = new Trend('auth_http_duration', true);
const tokenTtl = new Trend('access_token_ttl_seconds');
const refreshes = new Counter('auth_refresh_count'), authHttpFailed = new Rate('auth_http_failed');

const thresholds = {
  users_finished: [`count==${config.vus}`], target_unavailable: ['count==0'], invalid_responses: ['count==0'],
  'logical_failed{phase:measurement}': ['rate<0.01'], auth_failed: ['rate==0'], auth_http_failed: ['rate==0'],
  'auth_login_count{phase:measurement}': ['count>=0'],
  'auth_duration{operation:login,phase:measurement}': ['p(95)<=1000', 'p(99)<=3000'],
};
for (const action of actions) {
  const tags = `{action:${action},phase:measurement}`;
  for (const name of ['action_requested', 'action_completed', 'action_failed']) thresholds[`${name}${tags}`] = ['count>=0'];
  thresholds[`action_duration${tags}`] = [`p(95)<=${['listPublic', 'listOwn', 'read'].includes(action) ? 500 : 750}`, 'p(99)<=2000'];
  thresholds[`logical_failed${tags}`] = ['rate<0.01'];
}
export const options = {
  scenarios: { social: {
    executor: 'ramping-vus', startVUs: 0,
    stages: [
      { duration: `${config.rampSeconds}s`, target: config.vus },
      { duration: `${config.warmupSeconds}s`, target: config.vus },
      { duration: `${config.measurementSeconds}s`, target: config.vus },
    ], gracefulStop: '30s',
  } },
  thresholds, summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'error_code'],
};
let done = false;
const phase = () => Date.now() - exec.scenario.startTime < (config.rampSeconds + config.warmupSeconds) * 1000 ? 'warmup' : 'measurement';

export default async function () {
  if (done) { sleep(0.1); return; }
  const user = users[exec.vu.idInTest - 1];
  if (!user) throw new Error('Identity pool exhausted');
  const state = initialState(user, Array.from(visible), config);
  const actionRandom = random(config.seed + exec.vu.idInTest);
  const pacingRandom = random(config.seed + exec.vu.idInTest + 100000);
  const sessionRandom = random(config.seed + exec.vu.idInTest + 200000);
  const targetRandom = random(config.seed + exec.vu.idInTest + 300000);
  const uniform = (range, rng) => range[0] + (range[1] - range[0]) * rng();
  const end = exec.scenario.startTime + (config.rampSeconds + config.warmupSeconds + config.measurementSeconds) * 1000;
  let currentPhase = phase(), logoutFailed = false;
  const jar = new http.CookieJar();
  const request = async (method, url, body, params) => {
    const result = await http.asyncRequest(method, url, body, { ...params, jar, tags: { ...params.tags, phase: currentPhase } });
    if (url.includes('/api/auth/')) {
      const operation = new URL(url).pathname.split('/').at(-1);
      authHttp.add(result.timings.duration, { operation, phase: currentPhase });
      authHttpFailed.add(result.status < 200 || result.status >= 300, { operation, phase: currentPhase });
      if (operation === 'refresh') refreshes.add(1, { phase: currentPhase });
      if (operation === 'logout' && (result.status < 200 || result.status >= 300)) logoutFailed = true;
    }
    return result;
  };
  const client = initClient(undefined, { transport: createTransport(__ENV.BASE_URL ?? 'http://trailbase:4000', request) });
  const auth = async operation => {
    const started = Date.now(); let success = false;
    try {
      if (operation === 'login') {
        await client.login(user.username, user.password);
        if (client.user()?.id !== user.id) throw new Error('invalid_response');
        logins.add(1, { phase: currentPhase });
        const claims = JSON.parse(atob(client.tokens().auth_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
        if (Number.isFinite(claims.exp) && Number.isFinite(claims.iat)) tokenTtl.add(claims.exp - claims.iat);
      } else {
        logoutFailed = false; await client.logout();
        if (logoutFailed) throw new Error('Logout failed');
      }
      success = true;
    } finally {
      authDuration.add(Date.now() - started, { operation, phase: currentPhase });
      authFailed.add(!success, { operation, phase: currentPhase });
    }
  };
  let sessionEnd = 0;
  unavailable.add(0); invalid.add(0); refreshes.add(0);
  try {
    while (Date.now() < end) {
      currentPhase = phase();
      if (!client.user() || Date.now() >= sessionEnd) {
        try {
          if (client.user()) await auth('logout');
          await auth('login');
          sessionEnd = Date.now() + uniform(config.sessionSeconds, sessionRandom) * 1000;
        } catch { sleep(Math.min(uniform(config.thinkSeconds, pacingRandom), Math.max(0, (end - Date.now()) / 1000))); continue; }
      }
      currentPhase = phase();
      const action = chooseAction(config.weights, actionRandom), tags = { action, phase: currentPhase };
      requested.add(1, tags);
      const started = Date.now(); let success = false;
      try {
        await performAction(client, state, action, config, targetRandom, () => prerequisites.add(1, tags));
        success = true;
      } catch (error) {
        const reason = ['unavailable_target', 'invalid_response'].includes(error.message) ? error.message :
          (error.status ? `http_${error.status}` : 'transport_or_sdk');
        errors.add(1, { ...tags, reason });
        if (reason === 'unavailable_target') unavailable.add(1, tags);
        if (reason === 'invalid_response') invalid.add(1, tags);
      } finally {
        duration.add(Date.now() - started, tags); completed.add(1, tags);
        failed.add(success ? 0 : 1, tags); failureRate.add(!success, tags);
      }
      sleep(Math.min(uniform(config.thinkSeconds, pacingRandom), Math.max(0, (end - Date.now()) / 1000)));
    }
  } finally {
    currentPhase = 'cleanup';
    if (client.user()) { try { await auth('logout'); } catch { /* Recorded by auth_failed; no credential output. */ } }
    finished.add(1); done = true;
  }
}
