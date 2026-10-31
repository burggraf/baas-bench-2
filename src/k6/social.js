import http from 'k6/http';
import encoding from 'k6/encoding';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import URL from 'core-js-pure/actual/url/index.js';
import URLSearchParams from 'core-js-pure/actual/url-search-params/index.js';
import { initClient } from 'trailbase';
import { pocketbaseClient } from '../pocketbase.js';
import { createTransport } from './transport.js';
import { createAtob } from '../base64.js';
import { actions, validateConfig, random, chooseAction, preparedSchedule, preparedTokenTiming, createPreparedClock } from '../workload.js';
import { initialState, performAction } from '../actions.js';

globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
globalThis.atob = createAtob((value, format) => encoding.b64decode(value, format));
const config = validateConfig(JSON.parse(open('/config/run.json')));
const prepared = config.version === 'social-prepared-v1';
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
const lifecycle = prepared ? new Trend('prepared_user') : null;
const loginAttempts = prepared ? new Counter('auth_login_attempts') : null;
const loginFailures = prepared ? new Counter('auth_login_failed') : null;
const successDuration = prepared ? new Trend('auth_success_duration', true) : null;
const probeFailed = prepared ? new Rate('prepared_probe_failed') : null;

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
if (prepared) {
  delete thresholds['auth_duration{operation:login,phase:measurement}'];
  delete thresholds.http_req_failed;
  thresholds['http_reqs{traffic:backend,request_phase:measurement}'] = ['count>=0'];
  thresholds['auth_success_duration{phase:measurement}'] = ['p(95)<=1000', 'p(99)<=3000'];
  for (const phase of ['preparation','ramp','warmup','measurement','cleanup']) {
    for (const name of ['auth_login_attempts','auth_login_failed','auth_login_count','auth_refresh_count']) thresholds[`${name}{phase:${phase}}`] = ['count>=0'];
    if (phase !== 'measurement') thresholds[`auth_success_duration{phase:${phase}}`] = ['max>=0'];
    for (const operation of ['login','logout']) {
      thresholds[`auth_failed{operation:${operation},phase:${phase}}`] = ['rate==0'];
      thresholds[`auth_duration{operation:${operation},phase:${phase}}`] = ['max>=0'];
    }
    thresholds[`auth_http_failed{operation:refresh,phase:${phase}}`] = ['rate==0'];
    thresholds[`auth_http_duration{operation:refresh,phase:${phase}}`] = ['max>=0'];
  }
  thresholds.prepared_probe_failed = ['rate==0'];
  for (const traffic of ['backend','control']) {
    thresholds[`http_reqs{traffic:${traffic}}`] = ['count>=0'];
    thresholds[`http_req_failed{traffic:${traffic}}`] = [traffic === 'control' ? 'rate==0' : 'rate<0.01'];
  }
}
export const options = {
  scenarios: { social: prepared ? {
    executor: 'per-vu-iterations', vus: config.vus, iterations: 1,
    maxDuration: `${config.authPreparation.timeoutSeconds + config.rampSeconds + config.warmupSeconds + config.measurementSeconds + 32}s`, gracefulStop: '0s',
  } : {
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
let done = false, applicationStart = null;
let preparedNow;
const clockNow = () => {
  if (!prepared) return Date.now();
  try {
    preparedNow ??= createPreparedClock(Date.now, () => exec.instance.currentTestRunDuration);
    return preparedNow();
  } catch (error) {
    if (error.message !== 'prepared_clock_inconsistent') throw error;
    console.error(JSON.stringify({event:'prepared_clock_failure',ordinal:exec.vu.idInTest,...error.clockEvidence}));
    exec.test.abort('prepared_clock_inconsistent');
    throw error;
  }
};
const phase = () => !prepared ? (Date.now() - exec.scenario.startTime < (config.rampSeconds + config.warmupSeconds) * 1000 ? 'warmup' : 'measurement') :
  applicationStart === null ? 'preparation' : clockNow() < applicationStart + config.rampSeconds * 1000 ? 'ramp' : clockNow() < applicationStart + (config.rampSeconds + config.warmupSeconds) * 1000 ? 'warmup' : clockNow() < applicationStart + (config.rampSeconds + config.warmupSeconds + config.measurementSeconds) * 1000 ? 'measurement' : 'cleanup';

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
  // Initialization is outside the execution clock.
  if (prepared) clockNow();
  const now = clockNow;
  let end = exec.scenario.startTime + (config.rampSeconds + config.warmupSeconds + config.measurementSeconds) * 1000;
  let currentPhase = phase(), logoutFailed = false, lastLoginAt = null;
  const jar = new http.CookieJar();
  const request = async (method, url, body, params) => {
    const requestPhase = prepared ? phase() : currentPhase;
    const result = await http.asyncRequest(method, url, body, { ...params, jar, tags: { ...params.tags, phase: currentPhase, ...(prepared ? {traffic:'backend',request_phase:requestPhase} : {}) } });
    if (url.includes('/api/auth/') || /\/api\/collections\/users\/auth-/.test(url)) {
      const nativeOperation = new URL(url).pathname.split('/').at(-1);
      const operation = ({ 'auth-with-password': 'login', 'auth-refresh': 'refresh' })[nativeOperation] ?? nativeOperation;
      authHttp.add(result.timings.duration, { operation, phase: requestPhase });
      authHttpFailed.add(result.status < 200 || result.status >= 300, { operation, phase: requestPhase });
      if (operation === 'refresh') refreshes.add(1, { phase: requestPhase });
      if (operation === 'logout' && (result.status < 200 || result.status >= 300)) logoutFailed = true;
    }
    return result;
  };
  const origin = __ENV.BASE_URL ?? 'http://trailbase:4000';
  const transport = createTransport(origin, request);
  const client = __ENV.BENCH_BACKEND === 'pocketbase' ? pocketbaseClient(origin, (url, init) => {
    const target = new URL(url);
    if (target.origin !== origin) throw new Error('Unexpected SDK origin');
    return transport.fetch(target.pathname + target.search, init);
  }) : initClient(undefined, { transport });
  const auth = async operation => {
    const started = Date.now(); let success = false;
    if (prepared && operation === 'login') loginAttempts.add(1, {phase:currentPhase});
    try {
      if (operation === 'login') {
        await client.login(user.username, user.password);
        if (client.user()?.id !== user.id) throw new Error('invalid_response');
        if (!prepared) logins.add(1, { phase: currentPhase });
        lastLoginAt = Date.now();
        const claims = JSON.parse(atob(client.tokens().auth_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
        if (Number.isFinite(claims.exp) && Number.isFinite(claims.iat)) tokenTtl.add(claims.exp - claims.iat);
        if (prepared) logins.add(1, {phase:currentPhase});
      } else {
        logoutFailed = false; await client.logout();
        if (logoutFailed) throw new Error('Logout failed');
      }
      success = true;
    } finally {
      authDuration.add(Date.now() - started, { operation, phase: currentPhase });
      authFailed.add(!success, { operation, phase: currentPhase });
      if (prepared && operation === 'login') {
        loginFailures.add(success ? 0 : 1, {phase:currentPhase});
        if (success) successDuration.add(Date.now() - started, {phase:currentPhase});
      }
    }
  };
  let sessionEnd = 0, entered = false, normalCompletion = false;
  unavailable.add(0); invalid.add(0); refreshes.add(0);
  try {
    if (prepared) {
      const gateOrigin = __ENV.PREPARED_GATE_ORIGIN, runId = __ENV.PREPARED_RUN_ID;
      if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(gateOrigin ?? '') || Number(gateOrigin.split(':').at(-1)) > 65535 || !/^social-[A-Za-z0-9]{6}$/.test(runId ?? '')) exec.test.abort('missing_prepared_gate');
      const control = async (route, values = {}) => {
        const result = await http.asyncRequest('POST', gateOrigin + route, JSON.stringify({runId,ordinal:exec.vu.idInTest,...values}), {
          headers:{'content-type':'application/json'},timeout:`${config.authPreparation.timeoutSeconds+5}s`,redirects:0,
          tags:{name:`/prepared${route}`,phase:'preparation',traffic:'control'},
        });
        if (result.status !== 200) throw new Error('prepared_control_failed');
        return result.json();
      };
      try {
        await control('/admit');
        await auth('login');
        let probeValid = false;
        try {
          const own = await client.records('likes').list({pagination:{limit:100},count:true});
          if (client.user()?.id !== user.id || own.total_count !== user.likes.length || own.records.length !== user.likes.length || own.records.some(row => row.user !== user.id || !user.likes.some(like => like.id === row.id && like.post === row.post))) throw new Error('invalid_response');
          probeValid = true;
        } finally {probeFailed.add(!probeValid);}
        const claims = JSON.parse(atob(client.tokens().auth_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
        const tokenTiming = preparedTokenTiming(claims,lastLoginAt);
        lifecycle.add(exec.vu.idInTest,{event:'ready'});
        const release = await control('/ready',tokenTiming);
        if (!Number.isFinite(release.releaseAt) || release.releaseAt < now()) throw new Error('prepared_late_release');
        applicationStart = release.releaseAt;
        lifecycle.add(exec.vu.idInTest,{event:'released'});
        const schedule = preparedSchedule(config,applicationStart,exec.vu.idInTest);
        end = schedule.endAt;
        sleep(Math.max(0,Math.ceil(schedule.activationAt-now()))/1000);
        sessionEnd = schedule.activationAt + uniform(config.sessionSeconds,sessionRandom)*1000;
      } catch {
        try { await control('/failed',{reason:'auth_failed'}); } catch { /* Gate or child-exit evidence preserves the first failure. */ }
        exec.test.abort('auth_preparation_failed');
        return;
      }
    }
    while (now() < end) {
      currentPhase = phase();
      if (!client.user() || Date.now() >= sessionEnd) {
        try {
          if (client.user()) await auth('logout');
          await auth('login');
          sessionEnd = Date.now() + uniform(config.sessionSeconds, sessionRandom) * 1000;
        } catch { sleep(Math.min(uniform(config.thinkSeconds, pacingRandom), Math.max(0, (end - Date.now()) / 1000))); continue; }
      }
      currentPhase = phase();
      if (prepared) { if (now() >= end) break; currentPhase = phase(); }
      const action = chooseAction(config.weights, actionRandom), tags = { action, phase: currentPhase };
      if (prepared && currentPhase === 'measurement' && !entered) { lifecycle.add(exec.vu.idInTest,{event:'entered'}); entered = true; }
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
    normalCompletion = true;
  } finally {
    if (prepared && normalCompletion && entered) lifecycle.add(exec.vu.idInTest,{event:'completed'});
    currentPhase = 'cleanup';
    if (client.user()) { try { await auth('logout'); } catch { /* Recorded by auth_failed; no credential output. */ } }
    finished.add(1); done = true;
  }
}
