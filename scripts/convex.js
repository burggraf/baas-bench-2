import {fixtureSessions} from '../src/convex-fixture-sessions.js';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convexClient } from '../src/convex.js';
import {prepareConvex,verifyConvex,stopConvex} from './convex-deployment.js';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';
import * as workload from '../src/workload.js';
const { validateConfig } = workload;
import { campaignResourceStop, assertHostMemoryCoverage, campaignCpuPressure, classifyCampaignTrial, measurementStart } from '../src/campaign.js';
import { capture, execute, hash, runtimeManifest } from './runtime.js';
import { runWorkload, verifySizingHost } from './workload-run.js';
import { startMonitor } from './monitor.js';
import { capturePreparationEvidence } from './baseline.js';
import {convexConformance} from '../tests/convex-conformance.js';

const project = 'baas-bench-2-pilot', fixturePath = '.fixtures/convex.json';
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx' });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const setupProgress=new Map();
export function convexPlan(args) {
 const flags=['--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];
 assert.ok(flags.every(f=>args.includes(f))&&new Set(args).size===args.length,'Convex requires matched nine-CPU/48GiB/GC150/480MiB profile');
 const optimizedSetup=args.includes('--optimized-setup'),validationDataset=args.includes('--validation-dataset=1000');
 assert.ok(!validationDataset||optimizedSetup,'Validation dataset requires optimized setup');
 const {smoke,vus}=workload.preparedArguments(args.filter(a=>!flags.includes(a)&&a!=='--optimized-setup'&&a!=='--validation-dataset=1000'));
 assert.ok(smoke||vus>=10&&vus<=15000,'Use 10..15000 distinct active users');
 const configPath=smoke?'configs/prepared-smoke.json':'configs/prepared-social-12500.json',base=read(configPath);
 if(validationDataset){assert.ok(vus<=1000&&!smoke);base.dataset={profile:'pilot-small',users:1000,postsPerUser:10,likesPerUser:10};}
 const config=validateConfig({...base,...(smoke?{}:{vus,authPreparation:{...base.authPreparation,timeoutSeconds:Math.ceil(vus/5)+200}})});
 return {preparedSessions:true,points:[config.vus],smoke,configPath,config,runnerProfile:'9cpu-48g',runnerBudget:{cpus:9,memoryBytes:51539607552},runnerGc:150,payloadCacheBytes:480*1024*1024,fixturePreparationTimeoutSeconds:null,validationDataset,optimizedSetup};
}
export function nextConvexPoint(history, points) {
  assert.ok(history.length <= points.length && history.every((row, i) => row.vus === points[i]), 'Unexpected point order; never retry');
  if (history.some(row => row.verdict !== 'pass')) return null;
  return points[history.length] ?? null;
}
export function convexController(signal, log) {
  return convexClient('http://127.0.0.1:4000', async (url, init) => {
    signal.throwIfAborted();
    const route = new URL(url).pathname.replace(/(\/records)\/[^/]+$/, '$1/:id');
    const start = performance.now();
    const record = (stage, status = null) => {
      if(!log)return;
      const at=new Date().toISOString();
      appendFileSync(log,JSON.stringify({at,route,method:init.method,stage,status,durationMs:performance.now()-start})+'\n');
      if(stage==='headers'){
        const progress=setupProgress.get(log)??{kind:'untimed-controller-http-response-progress',responseHeaders:0,byRoute:{},startedAt:at};
        progress.responseHeaders++;progress.lastResponseAt=at;
        const key=`${init.method} ${route} ${status}`;progress.byRoute[key]=(progress.byRoute[key]??0)+1;setupProgress.set(log,progress);
        if(progress.responseHeaders%250===0)writeFileSync(log.replace('controller-requests.jsonl','setup-progress.json'),JSON.stringify(progress,null,2));
      }
    };
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
function assertDeployment(id,volume,run,point){return verifyConvex(id,volume,run,point);}
export async function runConvex(args = []) {
  const plan = convexPlan(args);
  assert.ok(!process.env.COMPOSE_FILE && !process.env.COMPOSE_PROJECT_NAME && !process.env.DOCKER_HOST, 'Use the local unmodified Docker context');
  assert.match(capture('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^unix:\/\//);
  const ids = () => capture('docker', ['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean);
  assert.equal(ids().length, 0, 'Stop existing pilot resources first');
  assert.equal(capture('docker', ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]), '');
  assert.ok(!existsSync(fixturePath) && !existsSync('.fixtures/operation.lock') && !existsSync('.fixtures/recovery.lock'), 'Inspect existing Convex fixture/claims; no automatic recovery');
  mkdirSync('results', { recursive: true });
  const directory = mkdtempSync('results/convex-'), run = directory.split('/').at(-1);
  const operation = { version: 1, pid: process.pid, command: 'convex', startedAt: new Date().toISOString(), baselineRunId: run };
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
    for (let point; (point = nextConvexPoint(history, plan.points)) !== null;) {
      cancel.signal.throwIfAborted();
      attemptedPoints.push(point);
      const number = history.length+1, trial = `${directory}/point-${point}`;
      mkdirSync(trial);
      const config = validateConfig(plan.preparedSessions ? plan.config : { ...read(plan.smoke ? 'configs/smoke.json' : 'configs/social-baseline.json'), vus: point });
      const configPath = `${trial}/config.json`; json(configPath, config);
      const volume = `${project}_${run}-${number}`;
      assert.ok(!capture('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n').includes(volume));
      capture('docker', ['volume', 'create', '--label', `baas-bench-2.convex=${run}`, '--label', `baas-bench-2.point=${point}`, volume]);
      const override = `${trial}/compose.json`; json(override, { volumes: { 'convex-data': { name: volume, external: true } }, ...(plan.runnerProfile==='9cpu-48g'?{services:{runner:{cpus:0,cpu_period:100000,cpu_quota:900000,mem_limit:plan.runnerBudget.memoryBytes,memswap_limit:plan.runnerBudget.memoryBytes}}}:{}) });
      Object.assign(process.env, { COMPOSE_FILE: [resolve('compose.convex.yaml'), resolve(override)].join(delimiter), COMPOSE_PROJECT_NAME: project, COMPOSE_PATH_SEPARATOR: delimiter });
      Object.assign(operation, { trialVolume: volume }); savePrivate('.fixtures/operation.lock', operation);
      let backendId, prep, trialError, fixtureAuth, stopped = null;
      const stop = reason => { stopped ??= reason; cancel.abort(); };
      try {
        json(`${trial}/fixture-preparation-policy.json`,{timeoutSeconds:plan.fixturePreparationTimeoutSeconds,scope:'untimed API fixture creation plus both baseline verifications; not the prepared-login gate or application phases'});
        await prepareConvex({volume,run,point,trial,signal:cancel.signal});
        await compose(['up', '-d', '--wait', 'convex']);
        backendId = capture('docker', ['compose', 'ps', '-q', 'convex']);
        assertDeployment(backendId, volume, run, point);
        await verifySizingHost(`${trial}/host-before-seed`, backendId, plan.runnerBudget?.memoryBytes ?? 17179869184);
        const disk = capture('docker', ['exec', backendId, 'df', '-Pk', '/convex/data']);
        json(`${trial}/disk.json`, { source: disk });
        assert.ok(Number(disk.trim().split('\n').at(-1).trim().split(/\s+/)[3]) >= 5*1024*1024, 'Need 5GiB disk reserve');
        const prepDirectory = `${trial}/preparation`; mkdirSync(prepDirectory);
        prep = await startMonitor(prepDirectory, backendId, `${run}-no-preparation-runner`, `${prepDirectory}/no-runner-cgroups.jsonl`, row => { const reason = campaignResourceStop(row, plan.runnerBudget?.memoryBytes ?? 17179869184); if (reason) stop(reason); }, true);
        const createClient = () => convexController(cancel.signal, `${trial}/controller-requests.jsonl`);
        json(`${trial}/conformance.json`, await convexConformance(createClient));
        const runtime = runtimeManifest(['package-lock.json', 'compose.convex.yaml', override, 'backends/convex/convex/schema.ts', 'backends/convex/convex/social.ts', 'backends/convex/convex/auth.ts', 'backends/convex/convex/auth.config.ts', 'backends/convex/convex/convex.config.ts', 'backends/convex/convex/users.ts', 'backends/convex/convex.json', 'scripts/convex-deployment.js','scripts/convex-postgres-group.js', 'src/convex.js', 'src/convex-fixture-sessions.js', 'src/fixture-auth.js', 'src/prepared-cleanup.js', 'src/fixtures.js', 'src/workload.js', 'src/actions.js', 'src/payload-cache.js', 'src/k6/payload-cache.js', 'scripts/payload-cache.js', 'src/k6/social.js', 'src/k6/transport.js', 'src/k6/search-params.js', 'src/campaign.js', 'src/report.js', 'src/resources.js', 'src/calibration-runner.js', 'scripts/convex.js', 'scripts/runtime.js', 'scripts/workload-run.js', 'scripts/monitor.js', 'scripts/recovery.js', 'scripts/build.js', 'tests/pocketbase-conformance.js', 'tests/convex-conformance.js', 'src/k6/headers.js', 'backends/convex/versions.json', ...(plan.preparedSessions?['src/prepared-gate.js','src/prepared-evidence.js','src/prepared-actions.js','src/base64.js','src/auth.js','runner/Dockerfile',plan.configPath]:[]), configPath], { service: 'convex', executable: '/convex/convex-local-backend', sdk: 'convex' });
        let initial = true;
        const persist = value => { savePrivate(fixturePath, { ...value, volume, preparation: runtime }, initial); initial = false; };
        console.log(`Convex ${point}: API preparation started (${config.dataset.users} accounts; no elapsed-time setup limit).`);
        fixtureAuth=plan.optimizedSetup?fixtureSessions(createClient):undefined;
        const fixture=await seedFixture(config,createClient,persist,fixtureAuth);if(fixtureAuth)fixture.preparationMethod='sdk-session-reuse-v1';
        console.log(`Convex ${point}: API dataset seeded and first baseline verification passed; second verification starting.`);
        Object.assign(fixture, { volume, preparation: runtime });
        const baseline = await verifyFixture(config, fixture, createClient,fixtureAuth);
        assert.equal(baseline.logicalHash, fixture.baseline.logicalHash);
        if (history.length) assert.equal(baseline.logicalHash, history[0].baseline.logicalHash);
        savePrivate(`.fixtures/archive/${run}-${point}-ready.json`, fixture, true);
        json(`${trial}/baseline.json`, { baseline, seedSeconds: fixture.seedSeconds, volume, runtime });
        if(fixtureAuth){await fixtureAuth.revokeBeforeMeasurement();json(`${trial}/setup-auth.json`,{method:fixture.preparationMethod,...fixtureAuth.stats,tokensPersisted:false,nativeSetupSessionsRevoked:true});}
        const preparation = await prep.stop(); prep = null;
        const records = lines(`${prepDirectory}/resources.jsonl`);
        assertHostMemoryCoverage(records, plan.runnerBudget?.memoryBytes ?? 17179869184);
        const samples = records.filter(row => row.type === 'cgroup' && row.role === 'backend');
        assert.ok(samples.length >= 2 && samples.every((row, i) => !i || row.elapsedMs-samples[i-1].elapsedMs <= 5000), 'Incomplete preparation evidence');
        assert.ok(records.every(row => campaignResourceStop(row, plan.runnerBudget?.memoryBytes ?? 17179869184) === null), 'Unsafe preparation');
        assert.ok(preparation.containers.backend, 'Missing backend preparation evidence');
        cancel.signal.throwIfAborted();
        console.log(`Convex ${point}: API baseline verified twice; timed workload starting.`);
        const workloadDirectory = mkdtempSync('results/social-');
        operation.workloadDirectory = workloadDirectory; savePrivate('.fixtures/operation.lock', operation);
        json(`${trial}/workload.json`, { directory: workloadDirectory });
        const report = await runWorkload({ directory: workloadDirectory, config, configPath, fixture, baseline, runtime, operation, signal: cancel.signal, ...(plan.preparedSessions?{interruption:()=>interrupted}:{}), boundedRunner: true, campaign: true, runnerProfile: plan.runnerProfile ?? '4cpu-16g', runnerGc:plan.runnerGc, payloadCacheBytes:plan.payloadCacheBytes, fixtureAuth,service: 'convex', dataPath: '/convex/data', fixturePath, createClient: signal => convexController(signal) });
        if(plan.validationDataset){Object.assign(report,{capacityEligible:false,validationOnly:true,datasetComparison:'1000-account workflow check; not comparable to the fixed 15000-account capacity series'});writeFileSync(`${workloadDirectory}/report.json`,JSON.stringify(report,null,2));}
        let measuredAt=null,cpuPressure=null,cpuEvidenceInvalid=false;
        try {
          if(!plan.preparedSessions||report.preparedEvidenceValid){
            measuredAt=plan.preparedSessions?report.phaseTiming.measurementAt:await measurementStart(`${workloadDirectory}/k6-metrics.json.gz`);
            cpuPressure=campaignCpuPressure(lines(`${workloadDirectory}/runner-cgroups.jsonl`),measuredAt,config.measurementSeconds,plan.runnerBudget?.cpus ?? 4);
          }
        } catch(error){if(!plan.preparedSessions)throw error;cpuEvidenceInvalid=true;}
        const classification = cpuEvidenceInvalid?{verdict:'invalid',reasons:['measurement_cpu_window_evidence'],certified:false}:classifyCampaignTrial(report,plan.preparedSessions&&!report.preparedEvidenceValid?{metrics:{}}:existsSync(`${workloadDirectory}/k6-summary.json`)?read(`${workloadDirectory}/k6-summary.json`):{metrics:{}},cpuPressure);
        const result = { vus: point,capacityEligible:!plan.validationDataset,validationOnly:plan.validationDataset, ...classification, baseline, workloadDirectory, cpuPressure, ...(plan.preparedSessions?{workloadVersion:config.version,measurementStartedAt:measuredAt===null?null:new Date(measuredAt).toISOString(),completeWindow:cpuPressure!==null}:{}), volume, certified: false };
        history.push(result); json(`${trial}/result.json`, result);
        savePrivate(`.fixtures/archive/${run}-${point}-used.json`, fixture, true);
        console.log(`Convex ${point}: ${classification.verdict}.`);
        if(plan.preparedSessions&&!report.cleanupVerified)throw Object.assign(new Error('Prepared runner/monitor cleanup unverified'),{retainLock:true});
        if(plan.preparedSessions&&!report.valid)break;
        if (classification.verdict !== 'pass') break;
        await deleteFixture(fixture, createClient, persist,fixtureAuth);
        assert.equal((await createClient().records('posts').list({pagination:{limit:1},count:true})).total_count,0);
        json(`${trial}/cleanup.json`,{apiPosts:0,volumeRetained:true});if(fixtureAuth)json(`${trial}/fixture-auth-total.json`,{...fixtureAuth.stats,tokensPersisted:false});unlinkSync(fixturePath);
      } catch (error) { trialError = error; throw error; }
      finally {
        try {
          let observerError;
          if(fixtureAuth)try{await fixtureAuth.close();}catch(error){observerError=error;uncertain=true;}
          if (prep) try { await prep.stop(); } catch (error) { observerError = error; uncertain = true; }
          const remaining = ids(); assert.ok(remaining.length <= 2, 'Unexpected project containers; refuse shutdown');
          if (remaining.length) {
            backendId ||= capture('docker',['compose','ps','-q','convex']);
            try { if(backendId)await capturePreparationEvidence(`${trial}/final`, backendId, `.fixtures/backend-logs/${run}-${point}`); }
            finally { await stopConvex({volume,run,point,trial}); }
          }else if(existsSync('.fixtures/convex-postgres-deployment.json'))await stopConvex({volume,run,point,trial});
          assert.equal(ids().length, 0);
          if (observerError) throw observerError;
        } catch (error) { uncertain = true; json(`${trial}/cleanup-failure.json`, { type: error.name,locations:error.stack?.split('\n').filter(l=>/^\s+at /.test(l)) }); if (!trialError) throw error; }
        if (stopped) json(`${trial}/safety-stop.json`, { reason: stopped });
      }

    }
  } catch (error) { uncertain ||= error.retainLock === true; failure = { type: error.name, code: error.code ?? null, locations: error.stack?.split('\n').filter(line => /^\s+at /.test(line)) }; json(`${directory}/failure.json`, failure); }
  finally {
    const completed = !failure && history.length === plan.points.length && history.every(row => row.verdict === 'pass');
    const summary = { backend: 'convex',capacityEligible:!plan.validationDataset,validationOnly:plan.validationDataset, fixturePreparationTimeoutSeconds:plan.fixturePreparationTimeoutSeconds, ...(plan.preparedSessions?{kind:'prepared-session-single-point',workloadVersion:plan.config.version,authPreparation:plan.config.authPreparation,discovery:false}:{}), points: plan.points, smoke: plan.smoke, history, completed, failure: failure ?? null, certified: false, limitations: ['Short single points; no repeated capacity/tail/headroom certification.', 'Native Convex Auth sessions and refresh tokens are revoked; protected functions verify live sessions.', 'API-seeded fresh isolated volumes retained. Own cleanup deletes users, username mappings, posts and likes and revokes sessions; inaccessible native password-component hashes remain in the retained volume.'] };
    json(`${directory}/summary.json`, summary);
    if (!uncertain) unlinkSync('.fixtures/operation.lock');
    for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
    delete process.env.COMPOSE_FILE; delete process.env.COMPOSE_PROJECT_NAME; delete process.env.COMPOSE_PATH_SEPARATOR;
    console.log(`Convex evidence: ${directory}; ${summary.completed ? 'all requested points passed' : 'stopped; no automatic retry'}.`);
    if (!summary.completed) process.exitCode = 1;
  }
  return { directory, history };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runConvex(process.argv.slice(2)).catch(error => { console.error(`Convex preflight failed (${error.name}); inspect fixture/claims. No automatic cleanup.`); process.exitCode = 1; });
}
