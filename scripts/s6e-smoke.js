import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from 'undici';
import { initialState, performAction } from '../src/actions.js';
import { deleteFixture, savePrivate, seedFixture, verifyFixture } from '../src/fixtures.js';
import { supabaseClient } from '../src/supabase.js';
import { actions, chooseAction, random, validateConfig } from '../src/workload.js';
import { supabaseConformance } from '../tests/supabase-conformance.js';

const [target, ...options] = process.argv.slice(2);
const loopback = options.includes('--loopback');
const [option, ...extra] = options.filter(value => value !== '--loopback');
const loadProfiles = new Map([['--load', 25], ['--vus=500', 500], ['--vus=1000', 1000], ['--vus=2000', 2000]]);
assert.ok(target && (option === undefined || loadProfiles.has(option)) && extra.length === 0,
  'Usage: node scripts/s6e-smoke.js <dedicated-s6e-project-origin> [--load|--vus=500|--vus=1000|--vus=2000] [--loopback]');
const loadUsers = loadProfiles.get(option);
const origin = new URL(target);
assert.match(origin.hostname, /^[a-z]{20}\.supabase\./, 'Expected a project ref in the s6e hostname');
const anonKey = process.env.SUPABASE_ANON_KEY;
const smoke = JSON.parse(readFileSync(new URL('../configs/smoke.json', import.meta.url)));
const config = validateConfig(loadUsers ? {
  ...smoke,
  dataset: { ...smoke.dataset, profile: 's6e-native-load', users: Math.max(50, loadUsers) },
  vus: loadUsers,
  rampSeconds: Math.max(10, loadUsers / 5),
  warmupSeconds: 10,
  measurementSeconds: 60,
  thinkSeconds: [0.2, 0.5],
} : smoke);
assert.ok(!loopback || origin.protocol === 'http:' && origin.port === '55321',
  'Loopback requires the local HTTP gateway port 55321');
const dispatcher = loopback ? new Agent({
  connect: {
    lookup(_hostname, options, callback) {
      const local = { address: '127.0.0.1', family: 4 };
      if (options.all) callback(null, [local]);
      else callback(null, local.address, local.family);
    },
  },
}) : undefined;
const requestErrors = Object.create(null);
let measurementStart = Infinity, measurementEnd = Infinity;
const createClient = () => supabaseClient(target, async (url, init) => {
  const endpoint = new URL(url);
  assert.equal(endpoint.origin, origin.origin);
  const began = performance.now();
  const measured = began >= measurementStart && began < measurementEnd;
  const family = endpoint.pathname.startsWith('/rest/v1/') ? 'rest' : 'auth';
  const record = reason => {
    const key = `${family}:${reason}`;
    requestErrors[key] = (requestErrors[key] ?? 0) + 1;
  };
  const signal = AbortSignal.timeout(10000);
  try {
    const response = await fetch(url, { ...init, dispatcher, redirect: 'error', signal });
    if (measured && !response.ok) {
      const body = await response.clone().json().catch(() => null);
      const code = typeof body?.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(body.code) ? ':' + body.code : '';
      record(`http_${response.status}${code}`);
    }
    return response;
  } catch (error) {
    if (measured) record(signal.aborted ? 'client_timeout' : (error.cause?.code || error.name || 'transport_error'));
    throw error;
  }
}, anonKey, { external: true });

mkdirSync('results', { recursive: true });
mkdirSync('.fixtures', { recursive: true, mode: 0o700 });
const directory = mkdtempSync('results/s6e-native-');
const privateDirectory = mkdtempSync('.fixtures/s6e-native-');
const persist = fixture => savePrivate(`${privateDirectory}/fixture.json`, fixture);
const samples = Object.fromEntries(actions.map(action => [action, []]));
const failures = Object.fromEntries(actions.map(action => [action, 0]));
const failureReasons = Object.create(null);
const participants = new Set();
const report = { target, generator: 'macOS-native Node.js', workload: config.version,
  capacityEligible: false, profile: loadUsers ? 'load' : 'smoke',
  users: config.vus, dataset: config.dataset, config,
  measurementSeconds: config.measurementSeconds, network: loopback ? 'loopback:127.0.0.1:55321' : 'project DNS', cleanupVerified: false };

async function run() {
  const empty = await createClient().records('posts').list({ pagination: { limit: 1 }, count: true });
  assert.equal(empty.total_count, 0, 'Use a fresh, dedicated benchmark project');
  report.conformance = await supabaseConformance(createClient);
  const fixture = await seedFixture(config, createClient, persist);
  await verifyFixture(config, fixture, createClient);
  const start = performance.now() + 100;
  const measurement = start + (config.rampSeconds + config.warmupSeconds) * 1000;
  const end = measurement + config.measurementSeconds * 1000;
  measurementStart = measurement;
  measurementEnd = end;
  report.measurementStartedAt = new Date(Date.now() + measurement - performance.now()).toISOString();
  const outcomes = await Promise.allSettled(fixture.users.slice(0, config.vus).map(async (user, index) => {
    const client = createClient();
    const state = initialState(user, fixture.visible, config);
    const actionRng = random(config.seed + index + 1);
    const targetRng = random(config.seed + index + 300001);
    const pacingRng = random(config.seed + index + 100001);
    const join = start + index * config.rampSeconds * 1000 / config.vus;
    await delay(Math.max(0, join - performance.now()));
    try {
      await client.login(user.username, user.password);
      assert.equal(client.user()?.id, user.id);
      while (performance.now() < end) {
        const action = chooseAction(config.weights, actionRng);
        const began = performance.now();
        try {
          await performAction(client, state, action, config, targetRng, () => {});
        } catch (error) {
          if (began >= measurement) {
            failures[action]++;
            const reason = error.status ? `http_${error.status}` : error.code || error.name || 'sdk_error';
            failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
          }
        }
        if (began >= measurement) {
          participants.add(index);
          samples[action].push(performance.now() - began);
        }
        const [min, max] = config.thinkSeconds;
        await delay(Math.max(0, Math.min(end - performance.now(), 1000 * (min + (max - min) * pacingRng()))));
      }
    } finally {
      if (client.user()) {
        // Avoid an artificial burst of global session revocations after measurement.
        if (loadUsers >= 500) await delay(index * 200);
        await client.logout();
      }
    }
  }));
  report.measuredUsers = participants.size;
  report.failureReasons = failureReasons;
  report.actions = Object.fromEntries(actions.map(action => {
    const values = samples[action].sort((a, b) => a - b);
    const percentile = p => values.length ? Number(values[Math.ceil(values.length * p) - 1].toFixed(2)) : null;
    return [action, { count: values.length, failures: failures[action], medianMs: percentile(0.5), p95Ms: percentile(0.95) }];
  }));
  await deleteFixture(fixture, createClient, persist);
  assert.equal((await createClient().records('posts').list({ pagination: { limit: 1 }, count: true })).total_count, 0);
  report.cleanupVerified = true;
  assert.ok(outcomes.every(result => result.status === 'fulfilled'), 'A benchmark user failed login or logout');
  assert.equal(report.measuredUsers, config.vus, 'Every user must participate in measurement');
  assert.ok(actions.every(action => samples[action].length > 0 && failures[action] === 0), 'An action was unmeasured or failed');
}

try {
  await run();
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed';
  report.error = error.name === 'AssertionError' ? error.message : (error.status ? `http_${error.status}` : error.code ?? error.name);
  process.exitCode = 1;
} finally {
  report.requestErrors = requestErrors;
  await dispatcher?.close();
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`${directory}/report.json (${report.outcome})`);
}
