import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pocketbaseClient } from '../src/pocketbase.js';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';
import * as workload from '../src/workload.js';
const { validateConfig } = workload;
import { nextCampaignTrial, campaignResourceStop, assertHostMemoryCoverage, campaignCpuPressure, classifyCampaignTrial, measurementStart } from '../src/campaign.js';
import { capture, execute, hash, runtimeManifest } from './runtime.js';
import { runWorkload, verifySizingHost } from './workload-run.js';
import { startMonitor } from './monitor.js';
import { capturePreparationEvidence } from './baseline.js';
import { pocketbaseConformance } from '../tests/pocketbase-conformance.js';

const project = 'baas-bench-2-pilot', fixturePath = '.fixtures/pocketbase.json';
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx' });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
export function pocketbasePlan(args) {
  if (args.includes('--prepared-sessions')) {
    const {smoke,vus}=workload.preparedArguments(args),configPath=smoke?'configs/prepared-smoke.json':'configs/prepared-social-baseline.json';
    const config=validateConfig({...read(configPath),...(vus===undefined?{}:{vus})});
    return {preparedSessions:true,points:[config.vus],smoke,configPath,config,runnerProfile:'4cpu-16g',runnerBudget:{cpus:4,memoryBytes:17179869184}};
  }
  assert.ok(args.length === 0 || (args.length === 1 && ['--smoke', '--lower', '--search'].includes(args[0])), 'Usage: node scripts/pocketbase.js [--smoke|--lower|--search]');
  if (args[0] === '--search') return { points: [], smoke: false, search: true };
  return { points: args[0] === '--smoke' ? [2] : args[0] === '--lower' ? [100, 500] : [1000, 1500, 2000], smoke: args[0] === '--smoke' };
}
export function nextPocketbaseSearch(history) {
  assert.ok(history.length <= 4 && history.every(row => row.vus > 100 && row.vus < 500) && (!history.length || history[0].vus === 300), 'Unexpected search history');
  const trials = [{ vus: 100, verdict: 'pass' }, ...history];
  const next = nextCampaignTrial(trials, { startVus: 300, minVus: 100, maxVus: 500, maxTrials: 5, precision: 0.1 });
  const lowerVus = Math.max(...trials.filter(row => row.verdict === 'pass').map(row => row.vus));
  const failures = history.filter(row => row.verdict === 'slo_failure').map(row => row.vus);
  if (!next.stop && next.phase === 'discovery') Object.assign(next, { vus: Math.floor((lowerVus+500)/2), phase: 'ceiling_probe' });
  return { ...next, lowerVus, upperVus: failures.length ? Math.min(...failures) : null, searchCeilingVus: 500 };
}
export function nextPocketbasePoint(history, points) {
  assert.ok(history.length <= points.length && history.every((row, i) => row.vus === points[i]), 'Unexpected point order; never retry');
  if (history.some(row => row.verdict !== 'pass')) return null;
  return points[history.length] ?? null;
}
export function pocketbaseController(signal, log) {
  return pocketbaseClient('http://127.0.0.1:4000', async (url, init) => {
    signal.throwIfAborted();
    const route = new URL(url).pathname.replace(/(\/records)\/[^/]+$/, '$1/:id');
    const start = performance.now();
    const record = (stage, status = null) => { if (log) appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), route, method: init.method, stage, status, durationMs: performance.now()-start })+'\n'); };
    record('request');
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      record('headers', response.status);
      const consume = response.json.bind(response);
      response.json = async () => { try { const value = await consume(); record('body', response.status); return value; } catch (error) { record('body_error', response.status); throw error; } };
      return response;
    } catch (error) { record('error'); throw error; }
  });
}
function assertDeployment(id, volume, run, point) {
  assert.match(id, /^[a-f0-9]{64}$/);
  const [state] = JSON.parse(capture('docker', ['inspect', id]));
  assert.equal(state.Id, id);
  assert.equal(state.Config.Labels['com.docker.compose.project'], project);
  assert.equal(state.Config.Labels['com.docker.compose.service'], 'pocketbase');
  const mount = state.Mounts.filter(m => m.Destination === '/app/pb_data');
  assert.equal(mount.length, 1); assert.equal(mount[0].Type, 'volume'); assert.equal(mount[0].Name, volume);
  const [v] = JSON.parse(capture('docker', ['volume', 'inspect', volume]));
  assert.equal(v.Name, volume); assert.equal(v.Driver, 'local'); assert.equal(v.Scope, 'local'); assert.ok(!v.Options || !Object.keys(v.Options).length);
  assert.equal(v.Labels['baas-bench-2.pocketbase'], run); assert.equal(v.Labels['baas-bench-2.point'], String(point));
  return state;
}
export async function runPocketbase(args = []) {
  const plan = pocketbasePlan(args);
  const referencePath = 'results/pocketbase-KLpleZ/point-100/result.json';
  const reference = plan.search ? read(referencePath) : null;
  if (reference) {
    const report = read(`${reference.workloadDirectory}/report.json`);
    assert.equal(reference.vus, 100); assert.equal(reference.verdict, 'pass');
    assert.equal(report.valid, true); assert.equal(report.resources.valid, true); assert.equal(report.exitStatus, 0);
    assert.deepEqual({ ...read('configs/social-baseline.json'), vus: 100 }, read(`${reference.workloadDirectory}/config.json`), 'Historical pass must use the identical workload');
  }
  assert.ok(!process.env.COMPOSE_FILE && !process.env.COMPOSE_PROJECT_NAME && !process.env.DOCKER_HOST, 'Use the local unmodified Docker context');
  assert.match(capture('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^unix:\/\//);
  const ids = () => capture('docker', ['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean);
  assert.equal(ids().length, 0, 'Stop existing pilot resources first');
  assert.equal(capture('docker', ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]), '');
  assert.ok(!existsSync(fixturePath) && !existsSync('.fixtures/operation.lock') && !existsSync('.fixtures/recovery.lock'), 'Inspect existing PocketBase fixture/claims; no automatic recovery');
  mkdirSync('results', { recursive: true });
  const directory = mkdtempSync('results/pocketbase-'), run = directory.split('/').at(-1);
  const operation = { version: 1, pid: process.pid, command: 'pocketbase', startedAt: new Date().toISOString(), baselineRunId: run };
  savePrivate('.fixtures/operation.lock', operation, true);
  const cancel = new AbortController(), history = [], attemptedPoints = [];
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(name => [name, () => {interrupted??=name;cancel.abort();}]));
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  let uncertain = false, failure, interrupted;
  const compose = async args => {
    try { const result = await execute('docker', ['compose', ...args], { timeout: 90000, maxBuffer: 1024*1024 }); appendFileSync(`${directory}/docker-stdout.log`, result.stdout); appendFileSync(`${directory}/docker-stderr.log`, result.stderr); }
    catch (error) { appendFileSync(`${directory}/docker-stdout.log`, error.stdout ?? ''); appendFileSync(`${directory}/docker-stderr.log`, error.stderr ?? ''); throw error; }
  };
  try {
    if (reference) json(`${directory}/reference.json`, { path: referencePath, hash: hash(referencePath), workloadDirectory: reference.workloadDirectory, reportHash: hash(`${reference.workloadDirectory}/report.json`), baseline: reference.baseline, searchCeilingVus: 500, ceilingIsSloFailure: false });
    for (let point; (point = plan.search ? nextPocketbaseSearch(history).vus ?? null : nextPocketbasePoint(history, plan.points)) !== null;) {
      cancel.signal.throwIfAborted();
      attemptedPoints.push(point);
      const number = history.length+1, trial = `${directory}/point-${point}`;
      mkdirSync(trial);
      const config = validateConfig(plan.preparedSessions ? plan.config : { ...read(plan.smoke ? 'configs/smoke.json' : 'configs/social-baseline.json'), vus: point });
      const configPath = `${trial}/config.json`; json(configPath, config);
      const volume = `${project}_${run}-${number}`;
      assert.ok(!capture('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n').includes(volume));
      capture('docker', ['volume', 'create', '--label', `baas-bench-2.pocketbase=${run}`, '--label', `baas-bench-2.point=${point}`, volume]);
      const override = `${trial}/compose.json`; json(override, { volumes: { 'pocketbase-data': { name: volume, external: true } } });
      Object.assign(process.env, { COMPOSE_FILE: [resolve('compose.pocketbase.yaml'), resolve(override)].join(delimiter), COMPOSE_PROJECT_NAME: project, COMPOSE_PATH_SEPARATOR: delimiter });
      Object.assign(operation, { trialVolume: volume }); savePrivate('.fixtures/operation.lock', operation);
      let backendId, prep, prepTimer, trialError, archiveToRelease, stopped = null;
      const stop = reason => { stopped ??= reason; cancel.abort(); };
      try {
        prepTimer = setTimeout(() => stop('preparation_deadline'), 120*60*1000);
        await compose(['up', '-d', '--wait', 'pocketbase']);
        backendId = capture('docker', ['compose', 'ps', '-q', 'pocketbase']);
        assertDeployment(backendId, volume, run, point);
        await verifySizingHost(`${trial}/host-before-seed`, backendId, 17179869184);
        const disk = capture('docker', ['exec', backendId, 'df', '-Pk', '/app/pb_data']);
        json(`${trial}/disk.json`, { source: disk });
        assert.ok(Number(disk.trim().split('\n').at(-1).trim().split(/\s+/)[3]) >= 5*1024*1024, 'Need 5GiB disk reserve');
        const prepDirectory = `${trial}/preparation`; mkdirSync(prepDirectory);
        prep = await startMonitor(prepDirectory, backendId, `${run}-no-preparation-runner`, `${prepDirectory}/no-runner-cgroups.jsonl`, row => { const reason = campaignResourceStop(row, 17179869184); if (reason) stop(reason); }, true);
        const createClient = () => pocketbaseController(cancel.signal, `${trial}/controller-requests.jsonl`);
        json(`${trial}/conformance.json`, await pocketbaseConformance(createClient));
        const runtime = runtimeManifest(['package-lock.json', 'compose.pocketbase.yaml', override, 'backends/pocketbase/Dockerfile', 'backends/pocketbase/pb_migrations/1792454400_social.js', 'src/pocketbase.js', 'src/fixtures.js', 'src/workload.js', 'src/actions.js', 'src/k6/social.js', 'src/k6/transport.js', 'src/campaign.js', 'src/report.js', 'src/resources.js', 'src/calibration-runner.js', 'scripts/pocketbase.js', 'scripts/runtime.js', 'scripts/workload-run.js', 'scripts/monitor.js', 'scripts/recovery.js', 'scripts/build.js', 'tests/pocketbase-conformance.js', ...(plan.preparedSessions?['src/prepared-gate.js','src/prepared-evidence.js','src/base64.js','src/auth.js','runner/Dockerfile',plan.configPath]:[]), configPath], { service: 'pocketbase', executable: '/app/pocketbase', sdk: 'pocketbase' });
        let initial = true;
        const persist = value => { savePrivate(fixturePath, { ...value, volume, preparation: runtime }, initial); initial = false; };
        console.log(`PocketBase ${point}: API preparation started (${config.dataset.users} accounts).`);
        const fixture = await seedFixture(config, createClient, persist);
        Object.assign(fixture, { volume, preparation: runtime });
        const baseline = await verifyFixture(config, fixture, createClient);
        assert.equal(baseline.logicalHash, fixture.baseline.logicalHash);
        if (reference) assert.equal(baseline.logicalHash, reference.baseline.logicalHash);
        if (history.length) assert.equal(baseline.logicalHash, history[0].baseline.logicalHash);
        savePrivate(`.fixtures/archive/${run}-${point}-ready.json`, fixture, true);
        json(`${trial}/baseline.json`, { baseline, seedSeconds: fixture.seedSeconds, volume, runtime });
        const preparation = await prep.stop(); prep = null;
        const records = lines(`${prepDirectory}/resources.jsonl`);
        assertHostMemoryCoverage(records, 17179869184);
        const samples = records.filter(row => row.type === 'cgroup' && row.role === 'backend');
        assert.ok(samples.length >= 2 && samples.every((row, i) => !i || row.elapsedMs-samples[i-1].elapsedMs <= 5000), 'Incomplete preparation evidence');
        assert.ok(records.every(row => campaignResourceStop(row, 17179869184) === null), 'Unsafe preparation');
        assert.ok(preparation.containers.backend, 'Missing backend preparation evidence');
        clearTimeout(prepTimer); cancel.signal.throwIfAborted();
        console.log(`PocketBase ${point}: API baseline verified twice; timed workload starting.`);
        const workloadDirectory = mkdtempSync('results/social-');
        operation.workloadDirectory = workloadDirectory; savePrivate('.fixtures/operation.lock', operation);
        json(`${trial}/workload.json`, { directory: workloadDirectory });
        const report = await runWorkload({ directory: workloadDirectory, config, configPath, fixture, baseline, runtime, operation, signal: cancel.signal, ...(plan.preparedSessions?{interruption:()=>interrupted}:{}), boundedRunner: true, campaign: true, runnerProfile: '4cpu-16g', service: 'pocketbase', dataPath: '/app/pb_data', fixturePath, createClient: signal => pocketbaseController(signal) });
        let measuredAt=null,cpuPressure=null,cpuEvidenceInvalid=false;
        try {
          if(!plan.preparedSessions||report.preparedEvidenceValid){
            measuredAt=plan.preparedSessions?report.phaseTiming.measurementAt:await measurementStart(`${workloadDirectory}/k6-metrics.json.gz`);
            cpuPressure=campaignCpuPressure(lines(`${workloadDirectory}/runner-cgroups.jsonl`),measuredAt,config.measurementSeconds);
          }
        } catch(error){if(!plan.preparedSessions)throw error;cpuEvidenceInvalid=true;}
        const classification = cpuEvidenceInvalid?{verdict:'invalid',reasons:['measurement_cpu_window_evidence'],certified:false}:classifyCampaignTrial(report,plan.preparedSessions&&!report.preparedEvidenceValid?{metrics:{}}:existsSync(`${workloadDirectory}/k6-summary.json`)?read(`${workloadDirectory}/k6-summary.json`):{metrics:{}},cpuPressure);
        const result = { vus: point, ...classification, baseline, workloadDirectory, cpuPressure, ...(plan.preparedSessions?{workloadVersion:config.version,measurementStartedAt:measuredAt===null?null:new Date(measuredAt).toISOString(),completeWindow:cpuPressure!==null}:{}), volume, certified: false };
        history.push(result); json(`${trial}/result.json`, result);
        savePrivate(`.fixtures/archive/${run}-${point}-used.json`, fixture, true);
        console.log(`PocketBase ${point}: ${classification.verdict}.`);
        if(plan.preparedSessions&&!report.cleanupVerified)throw Object.assign(new Error('Prepared runner/monitor cleanup unverified'),{retainLock:true});
        if(plan.preparedSessions&&!report.valid)break;
        if (plan.search && classification.verdict === 'slo_failure' && nextPocketbaseSearch(history).vus) {
          archiveToRelease = `.fixtures/archive/${run}-${point}-used.json`;
          assert.equal(hash(fixturePath), hash(archiveToRelease), 'Refuse release without byte-identical failed fixture archive');
        } else {
          if (classification.verdict !== 'pass') break;
          await deleteFixture(fixture, createClient, persist);
          assert.equal((await createClient().records('posts').list({ pagination: { limit: 1 }, count: true })).total_count, 0);
          json(`${trial}/cleanup.json`, { apiPosts: 0, volumeRetained: true }); unlinkSync(fixturePath);
        }
      } catch (error) { trialError = error; throw error; }
      finally {
        clearTimeout(prepTimer);
        try {
          let observerError;
          if (prep) try { await prep.stop(); } catch (error) { observerError = error; uncertain = true; }
          const remaining = ids(); assert.ok(remaining.length <= 1, 'Unexpected project containers; refuse shutdown');
          if (remaining.length) {
            backendId ??= remaining[0]; assert.equal(remaining[0], backendId); assertDeployment(backendId, volume, run, point);
            try { await capturePreparationEvidence(`${trial}/final`, backendId, `.fixtures/backend-logs/${run}-${point}`); }
            finally { await compose(['down']); }
          }
          assert.equal(ids().length, 0);
          if (observerError) throw observerError;
        } catch (error) { uncertain = true; json(`${trial}/cleanup-failure.json`, { type: error.name }); if (!trialError) throw error; }
        if (stopped) json(`${trial}/safety-stop.json`, { reason: stopped });
      }
      if (archiveToRelease) {
        assert.equal(hash(fixturePath), hash(archiveToRelease));
        json(`${trial}/retained-failure.json`, { archive: archiveToRelease, fixtureHash: hash(archiveToRelease), volume, volumeRetained: true, apiCleanupPerformed: false, checkedShutdown: true });
        unlinkSync(fixturePath);
      }
    }
  } catch (error) { uncertain ||= error.retainLock === true; failure = { type: error.name, code: error.code ?? null, locations: error.stack?.split('\n').filter(line => /^\s+at /.test(line)) }; json(`${directory}/failure.json`, failure); }
  finally {
    const search = plan.search ? nextPocketbaseSearch(history) : null;
    if (failure && search) { delete search.vus; delete search.phase; search.stop = 'safety_or_execution_failure'; }
    const completed = !failure && (search ? ['precision_reached', 'trial_limit_reached'].includes(search.stop) : history.length === plan.points.length && history.every(row => row.verdict === 'pass'));
    const summary = { backend: 'pocketbase', ...(plan.preparedSessions?{kind:'prepared-session-single-point',workloadVersion:plan.config.version,authPreparation:plan.config.authPreparation,discovery:false}:{}), points: plan.search ? attemptedPoints : plan.points, smoke: plan.smoke, ...(search ? { search } : {}), history, completed, failure: failure ?? null, certified: false, limitations: ['Short single points; no repeated capacity/tail/headroom certification.', 'Native stateless logout clears client auth only; no server logout request.', 'API-seeded fresh isolated volumes retained; no old TrailBase fixture/data changes.'] };
    json(`${directory}/summary.json`, summary);
    if (!uncertain) unlinkSync('.fixtures/operation.lock');
    for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
    delete process.env.COMPOSE_FILE; delete process.env.COMPOSE_PROJECT_NAME; delete process.env.COMPOSE_PATH_SEPARATOR;
    console.log(`PocketBase evidence: ${directory}; ${search ? `search ${search.stop}; no automatic retry` : summary.completed ? 'all requested points passed' : 'stopped; no automatic retry'}.`);
    if (!summary.completed) process.exitCode = 1;
  }
  return { directory, history };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPocketbase(process.argv.slice(2)).catch(error => { console.error(`PocketBase preflight failed (${error.name}); inspect fixture/claims. No automatic cleanup.`); process.exitCode = 1; });
}
