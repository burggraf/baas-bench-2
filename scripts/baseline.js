import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';
import { validateConfig } from '../src/workload.js';
import { controllerClient } from './client.js';
import { capture, runtimeManifest } from './runtime.js';
import { runWorkload } from './workload-run.js';

const project = 'baas-bench-2-pilot', fixturePath = '.fixtures/trailbase.json';
export function baselinePlan(args) {
  const workload = args.includes('--workload');
  assert.ok(workload ? new Set(args).size === args.length && args.every(arg => ['--workload', '--smoke', '--vus=100'].includes(arg)) && !(args.includes('--smoke') && args.includes('--vus=100')) : args.length <= 1 && !args[0]?.startsWith('--'), 'Usage: node scripts/baseline.js [config.json] | --workload [--smoke | --vus=100]');
  const configPath = workload ? (args.includes('--smoke') ? 'configs/smoke.json' : 'configs/pilot-small.json') : args[0] ?? 'configs/pilot-small.json';
  const config = validateConfig({ ...JSON.parse(readFileSync(configPath)), ...(workload && !args.includes('--smoke') ? { vus: args.includes('--vus=100') ? 100 : 50 } : {}) });
  return { workload, configPath, config, trials: workload ? 1 : 3, runnerBudget: workload ? { cpus: 4, memoryBytes: 2147483648 } : null };
}

export function assertBaselineVolume(volume, run, trial) {
  assert.match(run, /^baseline-[a-zA-Z0-9]{6}$/);
  assert.ok([1, 2, 3].includes(trial));
  assert.equal(volume.Name, `${project}_${run}-${trial}`, 'Refuse non-trial volume');
  assert.equal(volume.Driver, 'local'); assert.equal(volume.Scope, 'local');
  assert.ok(!volume.Options || Object.keys(volume.Options).length === 0, 'Refuse configured/remote/bind volume');
  assert.equal(volume.Labels?.['baas-bench-2.baseline'], run);
  assert.equal(volume.Labels?.['baas-bench-2.trial'], String(trial));
  assert.ok(Number.isFinite(Date.parse(volume.CreatedAt)));
}
export function assertBaselineBackend(state, id, volume) {
  assert.match(id, /^[a-f0-9]{64}$/); assert.equal(state.id, id);
  assert.equal(state.project, project); assert.equal(state.service, 'trailbase');
  const data = state.mounts.filter(m => m.Destination === '/app/traildepot');
  assert.equal(data.length, 1); assert.equal(data[0].Type, 'volume'); assert.equal(data[0].Name, volume);
}
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const volumeState = name => JSON.parse(capture('docker', ['volume', 'inspect', name]))[0];
const backendState = id => JSON.parse(capture('docker', ['inspect', '--format', '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"mounts":{{json .Mounts}}}', id]));
const containerIds = () => capture('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean);
const pilotState = () => {
  const name = `${project}_trailbase-data`;
  if (!capture('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n').includes(name)) return null;
  const v = volumeState(name);
  return { Name: v.Name, Driver: v.Driver, CreatedAt: v.CreatedAt, Labels: v.Labels };
};

async function main() {
  const plan = baselinePlan(process.argv.slice(2));
  const { config, workload } = plan;
  let configPath = plan.configPath;
  assert.ok(!process.env.COMPOSE_FILE && !process.env.COMPOSE_PROJECT_NAME && !process.env.DOCKER_HOST, 'Use the unmodified local pilot context');
  assert.match(capture('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^unix:\/\//, 'Only a local Unix Docker socket is supported');
  assert.equal(containerIds().length, 0, 'Stop the pilot and all its runners first');
  assert.equal(capture('docker', ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]), '', 'Inspect leftover project networks before proceeding');
  assert.ok(!existsSync(fixturePath) && !existsSync('.fixtures/recovery.lock'), 'Resolve existing credentials/recovery claim first');
  mkdirSync('results', { recursive: true });
  const directory = mkdtempSync('results/baseline-'), run = directory.split('/').at(-1);
  const operation = { version: 1, pid: process.pid, command: workload ? 'fresh-workload' : 'prepare', baselineRunId: run, startedAt: new Date().toISOString() };
  savePrivate('.fixtures/operation.lock', operation, true);
  const cancellation = new AbortController();
  let interrupted, uncertain = false;
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => { interrupted ??= signal; cancellation.abort(); }]));
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  if (workload) { configPath = `${directory}/workload-config.json`; json(configPath, config); }
  const report = { kind: workload ? 'fresh-deployment-workload-sizing' : 'fresh-deployment-baseline-proof', valid: false, certified: false, config, ...(workload ? { runnerBudget: plan.runnerBudget } : {}), pilotVolumeBefore: pilotState(), trials: [], limitations: ['Logical equivalence, not capacity/headroom certification; short fixed-load tails may be insufficient.', 'New volumes are retained, never deleted; caches/host state are not normalized.', 'Crash/partial-seed recovery requires manual inspection of the recorded trial volume; social recover does not support fresh-workload claims.'] };
  // Let fetch process socket-close events while replacing the server; never retry requests across deployments.
  const compose = async args => {
    try {
      const result = await promisify(execFile)('docker', ['compose', ...args], { timeout: 30000, maxBuffer: 1024 * 1024 });
      appendFileSync(`${directory}/docker-stdout.log`, result.stdout);
      appendFileSync(`${directory}/docker-stderr.log`, result.stderr);
    } catch (error) {
      appendFileSync(`${directory}/docker-stdout.log`, error.stdout ?? '');
      appendFileSync(`${directory}/docker-stderr.log`, error.stderr ?? '');
      throw error;
    }
  };
  try {
    for (let trial = 1; trial <= plan.trials; trial++) {
      cancellation.signal.throwIfAborted();
      const name = `${project}_${run}-${trial}`;
      assert.ok(!capture('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n').includes(name), 'Refuse existing trial volume');
      capture('docker', ['volume', 'create', '--label', `baas-bench-2.baseline=${run}`, '--label', `baas-bench-2.trial=${trial}`, name]);
      const volume = volumeState(name); assertBaselineVolume(volume, run, trial);
      const override = `${directory}/trial-${trial}.compose.json`;
      json(override, { volumes: { 'trailbase-data': { name, external: true } }, ...(workload ? { services: { runner: { cpus: plan.runnerBudget.cpus, mem_limit: plan.runnerBudget.memoryBytes, memswap_limit: plan.runnerBudget.memoryBytes } } } : {}) });
      Object.assign(process.env, { COMPOSE_FILE: [resolve('compose.yaml'), resolve(override)].join(delimiter), COMPOSE_PROJECT_NAME: project, COMPOSE_PATH_SEPARATOR: delimiter });
      operation.trialVolume = name; savePrivate('.fixtures/operation.lock', operation);
      let backendId;
      try {
        await compose(['up', '-d', '--wait', 'trailbase']);
        backendId = capture('docker', ['compose', 'ps', '-q', 'trailbase']);
        assertBaselineBackend(backendState(backendId), backendId, name);
        const runtime = runtimeManifest(['package-lock.json', 'compose.yaml', override, 'backends/trailbase/Dockerfile', 'backends/trailbase/configuration/config.textproto', 'backends/trailbase/configuration/migrations/main/U1792454400__social_schema.sql', 'src/fixtures.js', 'src/workload.js', 'scripts/baseline.js', 'scripts/client.js', 'scripts/runtime.js', ...(workload ? ['scripts/workload-run.js', 'scripts/monitor.js', 'scripts/recovery.js', 'scripts/build.js', 'src/actions.js', 'src/report.js', 'src/resources.js', 'src/auth.js', 'src/base64.js', 'src/k6/social.js', 'src/k6/transport.js', 'src/calibration-runner.js', plan.configPath] : []), configPath]);
        if (workload) { assert.equal(runtime.backendPlatform, 'linux/arm64'); assert.equal(runtime.runnerPlatform, 'linux/arm64'); }
        const createClient = () => controllerClient(cancellation.signal);
        let initial = true;
        const persist = value => { savePrivate(fixturePath, { ...value, volume: name, preparation: runtime }, initial); initial = false; };
        const fixture = await seedFixture(config, createClient, persist);
        if (workload) Object.assign(fixture, { volume: name, preparation: runtime });
        const baseline = await verifyFixture(config, fixture, createClient);
        assert.equal(baseline.logicalHash, fixture.baseline.logicalHash);
        if (report.trials.length) assert.equal(baseline.logicalHash, report.trials[0].baseline.logicalHash, 'Fresh baselines differ');
        const evidence = { volume, backendId, runtime, baseline, seedSeconds: fixture.seedSeconds, identityHash: digest(fixture.users.map(u => u.id)), volumeRetained: true };
        // Persist preparation evidence before deleting its accounts; never publish credentials.
        json(`${directory}/trial-${trial}.json`, evidence);
        if (workload) {
          const workloadDirectory = mkdtempSync('results/social-');
          operation.workloadDirectory = workloadDirectory; savePrivate('.fixtures/operation.lock', operation);
          const result = await runWorkload({ directory: workloadDirectory, config, configPath, fixture, baseline, runtime, operation, signal: cancellation.signal, interruption: () => interrupted, boundedRunner: true });
          evidence.workload = { directory: workloadDirectory, report: result };
          json(`${directory}/trial-${trial}.json`, evidence);
        }
        await deleteFixture(fixture, createClient, persist);
        const posts = (await createClient().records('posts').list({ pagination: { limit: 1 }, count: true })).total_count;
        assert.equal(posts, 0, 'API cleanup must leave zero public posts');
        evidence.apiReset = { posts }; json(`${directory}/trial-${trial}.json`, evidence);
        unlinkSync(fixturePath); report.trials.push(evidence);
      } finally {
        try {
          const ids = containerIds();
          assert.ok(ids.length <= 1, 'Refuse shutdown with unexpected project containers');
          if (ids.length) {
            backendId ??= ids[0];
            assertBaselineBackend(backendState(ids[0]), backendId, name);
          }
          assertBaselineVolume(volumeState(name), run, trial);
          await compose(['down']);
          assert.equal(containerIds().length, 0);
        } catch (error) { uncertain = true; throw error; }
      }
      json(`${directory}/report.json`, report);
    }
    assert.equal(new Set(report.trials.map(t => t.identityHash)).size, plan.trials, 'Fresh native identities must differ');
    report.pilotVolumeAfter = pilotState(); assert.deepEqual(report.pilotVolumeAfter, report.pilotVolumeBefore);
    report.valid = !interrupted;
    console.log(`${workload ? 'Fresh workload' : 'Baseline'} proof: ${directory}`);
  } catch (error) {
    uncertain ||= error.retainLock === true;
    if (workload && operation.workloadDirectory && interrupted) json(`${operation.workloadDirectory}/interruption.json`, { signal: interrupted, at: new Date().toISOString(), valid: false });
    json(`${directory}/failure.json`, { type: error.name, code: error.code ?? error.cause?.code ?? null, locations: error.stack?.split('\n').filter(line => /^\s+at /.test(line)), interrupted: interrupted ?? null });
    console.error(`Baseline proof failed (${error.name}); inspect ${directory} and private fixture/operation state. No volume was deleted.`);
    process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
  } finally {
    json(`${directory}/report.json`, report);
    if (!uncertain) unlinkSync('.fixtures/operation.lock');
    for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
    delete process.env.COMPOSE_FILE; delete process.env.COMPOSE_PROJECT_NAME; delete process.env.COMPOSE_PATH_SEPARATOR;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Baseline preflight failed (${error.name}); inspect local project/lock state. No automatic cleanup.`); process.exitCode = 1; });
}
