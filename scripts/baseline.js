import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';
import {readPreparedTemplate,assertPreparedTemplateVolume,fixtureForPreparedRun,preparedDirectoryDigest,copyPreparedDirectory} from '../src/prepared-template.js';
import * as workloadContract from '../src/workload.js';
const { validateConfig } = workloadContract;
import { controllerClient } from './client.js';
import { capture, runtimeManifest, execute, captureHostMemory, hash } from './runtime.js';
import { captureCgroups, captureHostCgroups } from './monitor.js';
import { runWorkload, verifySizingHost } from './workload-run.js';
import { nextCampaignTrial, classifyCampaignTrial, campaignCpuPressure, measurementStart, prestartMemoryReserve } from '../src/campaign.js';

const project = 'baas-bench-2-pilot', fixturePath = '.fixtures/trailbase.json';
export function baselinePlan(args) {
  const templates=args.filter(arg=>arg.startsWith('--prepared-template='));
  if(templates.length){
    assert.equal(templates.length,1);assert.ok(args.includes('--prepared-sessions'),'Templates require the normal prepared single-point profile');
    const preparedTemplatePath=templates[0].slice('--prepared-template='.length);assert.ok(preparedTemplatePath.endsWith('.json')&&!preparedTemplatePath.includes('\0'),'Use a private template JSON file');
    return {...baselinePlan(args.filter(arg=>arg!==templates[0])),preparedTemplatePath};
  }
  if (args.includes('--prepared-sessions')) {
    const {smoke,vus}=workloadContract.preparedArguments(args),configPath=smoke?'configs/prepared-smoke.json':'configs/prepared-social-baseline.json';
    const config=validateConfig({...JSON.parse(readFileSync(configPath)),...(vus===undefined?{}:{vus})});
    return {preparedSessions:true,workload:true,configPath,config,trials:1,runnerBudget:{cpus:4,memoryBytes:17179869184},runnerProfile:'4cpu-16g',hostSafety:true};
  }
  if (args.includes('--backend-memory-stop=95')) {
    assert.ok(new Set(args).size === args.length && args.includes('--campaign') && args.includes('--runner-memory=16g'), 'Backend95 requires the explicit16GiB campaign');
    return { ...baselinePlan(args.filter(a => a !== '--backend-memory-stop=95')), backendMemoryStopFraction: 0.95 };
  }
  if (args.includes('--runner-memory=16g')) {
    assert.ok(new Set(args).size === args.length && !args.includes('--runner-memory=4g'), 'Use one explicit runner memory profile');
    const plan = baselinePlan(args.map(a => a === '--runner-memory=16g' ? '--runner-memory=4g' : a));
    assert.ok(args.includes('--smoke') || (plan.campaign && [1500, 2000].includes(plan.config.vus) && plan.trials === 1), '16-GiB profile requires an approved single 1500/2000-user point or correctness smoke');
    return { ...plan, runnerBudget: { cpus: 4, memoryBytes: 17179869184 }, runnerProfile: '4cpu-16g' };
  }
  if (args.includes('--runner-memory=4g')) {
    const smoke = args.includes('--smoke');
    if (args.includes('--campaign')) {
      const candidate = args.find(a => /^--vus=([1-7]\d{3}|8000)$/.test(a));
      assert.ok(new Set(args).size === args.length && args.every(a => ['--campaign', '--runner-memory=4g', ...(smoke ? ['--smoke'] : [candidate])].includes(a)) && (smoke || candidate), '4-GiB discovery requires one integer candidate 1000..8000, or correctness smoke');
      const plan = baselinePlan(smoke ? ['--campaign', '--smoke'] : ['--campaign']);
      // One candidate per invocation lets the audited run ledger enforce the overall eight-trial search.
      if (!smoke) { const vus = Number(candidate.slice('--vus='.length)); plan.config = validateConfig({ ...plan.config, vus }); plan.trials = 1; plan.search = { ...plan.search, startVus: vus, minVus: 1000, maxTrials: 1 }; }
      return { ...plan, runnerBudget: { cpus: 4, memoryBytes: 4294967296 }, runnerProfile: '4cpu-4g', hostSafety: true };
    }
    assert.ok(new Set(args).size === args.length && args.includes('--workload') && smoke !== args.includes('--vus=1000') && args.every(a => ['--workload', '--smoke', '--vus=1000', '--runner-memory=4g'].includes(a)), 'Only the approved 1000-user/4-GiB pair or its smoke is supported');
    const configPath = smoke ? 'configs/smoke.json' : 'configs/social-baseline.json';
    return { workload: true, configPath, config: validateConfig(JSON.parse(readFileSync(configPath))), trials: 1, runnerBudget: { cpus: 4, memoryBytes: 4294967296 }, runnerProfile: '4cpu-4g', hostSafety: true };
  }
  const campaign = args.includes('--campaign');
  if (campaign) {
    assert.ok(new Set(args).size === args.length && args.every(a => ['--campaign', '--smoke'].includes(a)), 'Usage: node scripts/baseline.js --campaign [--smoke]');
    const smoke = args.includes('--smoke'), configPath = smoke ? 'configs/smoke.json' : 'configs/social-baseline.json';
    return { campaign: true, workload: true, configPath, config: validateConfig(JSON.parse(readFileSync(configPath))), trials: 8, runnerBudget: { cpus: 4, memoryBytes: 2147483648 }, search: { startVus: smoke ? 2 : 1000, minVus: smoke ? 1 : 100, maxVus: smoke ? 4 : 8000, maxTrials: 8, precision: 0.1 } };
  }
  const workload = args.includes('--workload');
  assert.ok(workload ? new Set(args).size === args.length && args.every(arg => ['--workload', '--smoke', '--vus=100'].includes(arg)) && !(args.includes('--smoke') && args.includes('--vus=100')) : args.length <= 1 && !args[0]?.startsWith('--'), 'Usage: node scripts/baseline.js [config.json] | --workload [--smoke | --vus=100]');
  const configPath = workload ? (args.includes('--smoke') ? 'configs/smoke.json' : 'configs/pilot-small.json') : args[0] ?? 'configs/pilot-small.json';
  const config = validateConfig({ ...JSON.parse(readFileSync(configPath)), ...(workload && !args.includes('--smoke') ? { vus: args.includes('--vus=100') ? 100 : 50 } : {}) });
  return { workload, configPath, config, trials: workload ? 1 : 3, runnerBudget: workload ? { cpus: 4, memoryBytes: 2147483648 } : null };
}

export function assertBaselineVolume(volume, run, trial, maximum = 3) {
  assert.match(run, /^baseline-[a-zA-Z0-9]{6}$/);
  assert.ok([3, 8].includes(maximum) && Number.isSafeInteger(trial) && trial >= 1 && trial <= maximum);
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
export async function capturePreparationEvidence(prefix, backendId, privateDirectory) {
  assert.match(backendId, /^[a-f0-9]{64}$/);
  const evidence = { backendId, at: new Date().toISOString(), complete: false, failures: [] };
  savePrivate(`${privateDirectory}/metadata.json`, { backendId, publicPrefix: prefix }, true);
  const attempt = async (operation, work) => {
    try { await work(); }
    catch (error) {
      evidence.failures.push(operation);
      savePrivate(`${privateDirectory}/${operation}-error.json`, { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code ?? null, killed: error.killed ?? false }, true);
    }
  };
  await attempt('logs', async () => {
    let result, failure;
    try { result = await execute('docker', ['logs', '--timestamps', backendId], { timeout: 10000, maxBuffer: 32 * 1024 * 1024 }); }
    catch (error) { result = error; failure = error; }
    for (const stream of ['stdout', 'stderr']) writeFileSync(`${privateDirectory}/${stream}.log`, result[stream] ?? '', { mode: 0o600, flag: 'wx' });
    evidence.logs = { privateDirectory, stdoutHash: hash(`${privateDirectory}/stdout.log`), stderrHash: hash(`${privateDirectory}/stderr.log`) };
    if (failure) throw failure;
  });
  await attempt('inspect', async () => {
    const format = '{"id":{{json .Id}},"pid":{{json .State.Pid}},"running":{{json .State.Running}},"status":{{json .State.Status}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{json .State.ExitCode}},"restarts":{{json .RestartCount}},"health":{{if index .State "Health"}}{{json .State.Health.Status}}{{else}}null{{end}},"memoryLimit":{{json .HostConfig.Memory}},"memorySwap":{{json .HostConfig.MemorySwap}},"nanoCpus":{{json .HostConfig.NanoCpus}}}';
    evidence.inspection = JSON.parse((await execute('docker', ['inspect', '--format', format, backendId], { timeout: 2000 })).stdout);
    assert.equal(evidence.inspection.id, backendId);
  });
  await attempt('cgroups', async () => { evidence.cgroups = process.platform === 'linux' ? await captureHostCgroups(evidence.inspection) : await captureCgroups(backendId, args => execute('docker', args, { timeout: 2000 })); });
  await attempt('host', async () => { evidence.hostMemory = await captureHostMemory(); });
  evidence.complete = evidence.failures.length === 0;
  writeFileSync(`${prefix}.backend-evidence.json`, JSON.stringify(evidence, null, 2));
  if (!evidence.complete) throw Object.assign(new Error('Backend preparation diagnostic capture incomplete'), { name: 'PreparationEvidenceError' });
  return evidence;
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
  let { config } = plan;
  const template=plan.preparedTemplatePath?readPreparedTemplate(plan.preparedTemplatePath):null;
  const templateFileHash=template?hash(plan.preparedTemplatePath):null;
  if(template)fixtureForPreparedRun(template,config,'preflight-only');
  const checkTemplate=async()=>{
    assert.equal(hash(plan.preparedTemplatePath),templateFileHash,'Template credentials changed');
    const state=volumeState(template.volume);assertPreparedTemplateVolume(state,template);
    assert.equal(capture('docker',['ps','-aq','--filter',`volume=${state.Name}`]),'','Template must remain unmounted');
    assert.deepEqual(await preparedDirectoryDigest(state.Mountpoint),template.preparedTemplate.tree,'Template data changed');return state;
  };
  const { workload, campaign, preparedSessions, runnerProfile, hostSafety, backendMemoryStopFraction = 0.85 } = plan;
  if (hostSafety) assert.ok(['linux', 'darwin'].includes(process.platform), 'Host-pressure guarded runs require Linux or macOS');
  const next = trials => nextCampaignTrial(trials.map(t => ({ ...t.candidate, verdict: t.classification.verdict })), plan.search);
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
  if (workload && !campaign) { configPath = `${directory}/workload-config.json`; json(configPath, config); }
  const report = { kind: preparedSessions ? 'prepared-session-single-point' : campaign ? 'bounded-local-discovery' : workload ? 'fresh-deployment-workload-sizing' : 'fresh-deployment-baseline-proof', ...(preparedSessions?{workloadVersion:config.version,authPreparation:config.authPreparation,discovery:false}:{}), ...(campaign ? { limits: plan.search, safetyPolicy: { memoryStopFraction: 0.85, backendMemoryStopFraction, measuredRunnerCpuCores: 3.6, cpuWindowSeconds: 5 }, generatorHeadroom: 'unverified' } : {}), valid: false, certified: false, config, ...(workload ? { runnerBudget: plan.runnerBudget } : {}), ...(hostSafety ? { runnerProfile, hostSafety: { memoryStopFraction: 0.85, backendMemoryStopFraction, liveVmReserveBytes: 1073741824, prestartVmReserveBytes: prestartMemoryReserve(plan.runnerBudget.memoryBytes), requireZeroVmSwapUsed: true, ...(process.platform === 'darwin' ? { normalMacosPressure: '1' } : { hostMemorySource: '/proc/meminfo' }), measuredRunnerCpuCores: 3.6, cpuWindowSeconds: 5 } } : {}), pilotVolumeBefore: pilotState(), trials: [], limitations: ['Logical equivalence, not capacity/headroom certification; short fixed-load tails may be insufficient.', 'New volumes are retained, never deleted; caches/host state are not normalized.', 'Crash/partial-seed recovery requires manual inspection of the recorded trial volume; social recover does not support fresh-workload claims.'] };
  // Let fetch process socket-close events while replacing the server; never retry requests across deployments.
  const compose = async args => {
    try {
      const result = await execute('docker', ['compose', ...args], { timeout: 30000, maxBuffer: 1024 * 1024 });
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
      const candidate = campaign ? next(report.trials) : null;
      if (candidate?.stop) { report.search = candidate; break; }
      if (campaign) {
        config = validateConfig({ ...plan.config, vus: candidate.vus });
        configPath = `${directory}/trial-${trial}.config.json`; json(configPath, config);
        report.activeTrial = { number: trial, candidate }; json(`${directory}/report.json`, report);
        console.log(`Campaign trial ${trial}/${plan.trials}: ${candidate.vus} users (${candidate.phase}); fresh ${config.dataset.profile}.`);
      }
      const name = `${project}_${run}-${trial}`;
      assert.ok(!capture('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n').includes(name), 'Refuse existing trial volume');
      capture('docker', ['volume', 'create', '--label', `baas-bench-2.baseline=${run}`, '--label', `baas-bench-2.trial=${trial}`, name]);
      const volume = volumeState(name); assertBaselineVolume(volume, run, trial, campaign ? 8 : 3);
      const override = `${directory}/trial-${trial}.compose.json`;
      json(override, { volumes: { 'trailbase-data': { name, external: true } }, ...(workload ? { services: { runner: { cpus: plan.runnerBudget.cpus, mem_limit: plan.runnerBudget.memoryBytes, memswap_limit: plan.runnerBudget.memoryBytes } } } : {}) });
      Object.assign(process.env, { COMPOSE_FILE: [resolve('compose.yaml'), resolve(override)].join(delimiter), COMPOSE_PROJECT_NAME: project, COMPOSE_PATH_SEPARATOR: delimiter });
      if (campaign) { for (const key of ['runId', 'runnerImageId', 'monitorPid', 'workloadDirectory']) delete operation[key]; report.activeTrial.volume = name; }
      operation.trialVolume = name; savePrivate('.fixtures/operation.lock', operation);
      let backendId, trialError;
      try {
        let templateEvidence;
        if(template){
          assert.equal(process.platform,'linux','Offline local-volume copying requires Linux');
          const source=await checkTemplate();
          assert.equal(capture('docker',['ps','-aq','--filter',`volume=${name}`]),'','Copy target must be unmounted');
          const tree=await copyPreparedDirectory(source.Mountpoint,volume.Mountpoint);assert.deepEqual(tree,template.preparedTemplate.tree);
          templateEvidence={id:template.preparedTemplate.id,sourceVolume:source.Name,templateFileHash,sourceFixtureHash:template.preparedTemplate.sourceFixtureHash,tree,applicationMutatesTemplate:false};
          cancellation.signal.throwIfAborted();
        }
        await compose(['up', '-d', '--wait', 'trailbase']);
        backendId = capture('docker', ['compose', 'ps', '-q', 'trailbase']);
        assertBaselineBackend(backendState(backendId), backendId, name);
        if (campaign || hostSafety) {
          const disk = capture('docker', ['compose', 'exec', '-T', 'trailbase', 'df', '-Pk', '/app/traildepot']);
          writeFileSync(`${directory}/trial-${trial}.disk-before-seed.txt`, disk);
          const free = Number(disk.trim().split('\n').at(-1).trim().split(/\s+/)[3]);
          assert.ok(Number.isSafeInteger(free) && free >= 5 * 1024 * 1024, 'Campaign requires at least 5 GiB available before preparation');
          console.log(`${campaign ? 'Campaign' : 'Sizing'} trial ${trial}: ${template?'copied baseline API verification':'API preparation'} started; ${config.dataset.users} accounts.`);
        }
        if (hostSafety) await verifySizingHost(`${directory}/trial-${trial}-host-before-seed`, backendId, plan.runnerBudget.memoryBytes);
        const runtime = runtimeManifest(['package-lock.json', 'compose.yaml', override, 'backends/trailbase/Dockerfile', 'backends/trailbase/configuration/config.textproto', 'backends/trailbase/configuration/migrations/main/U1792454400__social_schema.sql', 'src/fixtures.js', 'src/prepared-template.js', 'src/workload.js', 'scripts/baseline.js', 'scripts/client.js', 'scripts/runtime.js', 'scripts/monitor.js', ...(workload ? ['scripts/workload-run.js', 'scripts/recovery.js', 'scripts/build.js', 'src/actions.js', 'src/report.js', 'src/resources.js', 'src/auth.js', 'src/base64.js', 'src/k6/social.js', 'src/k6/transport.js', 'src/calibration-runner.js', 'src/campaign.js', ...(preparedSessions?['src/prepared-gate.js','src/prepared-evidence.js','src/pocketbase.js','runner/Dockerfile']:[]), ...(template?['scripts/prepared-template.js']:[]), plan.configPath] : []), configPath]);
        const requestLog = `${directory}/trial-${trial}.controller-requests.jsonl`;
        const createClient = () => controllerClient(cancellation.signal, row => appendFileSync(requestLog, JSON.stringify(row) + '\n'));
        let initial = true;
        const persist = value => { savePrivate(fixturePath, { ...value, volume: name, preparation: runtime }, initial); initial = false; };
        if(template){
          assert.equal(runtime.sdkVersion,template.preparation.sdkVersion);assert.equal(runtime.serverVersion,template.preparation.serverVersion);
          const original=JSON.parse(capture('docker',['image','inspect',template.preparation.backend.imageId]))[0],current=JSON.parse(capture('docker',['image','inspect',runtime.backend.imageId]))[0];
          assert.deepEqual(current.RootFS,original.RootFS,'Template backend filesystem version differs');assert.equal(current.Os,original.Os);assert.equal(current.Architecture,original.Architecture);
        }
        const fixture = template?fixtureForPreparedRun(template,config,name):await seedFixture(config, createClient, persist);
        if(template)persist(fixture);
        if (workload) Object.assign(fixture, { volume: name, preparation: runtime });
        const baseline = await verifyFixture(config, fixture, createClient);
        assert.equal(baseline.logicalHash, fixture.baseline.logicalHash);
        if (report.trials.length) assert.equal(baseline.logicalHash, report.trials[0].baseline.logicalHash, 'Fresh baselines differ');
        if (campaign || hostSafety) console.log(`${campaign ? 'Campaign' : 'Sizing'} trial ${trial}: API baseline verified; ${template?'registration not exercised (verified template copy)':fixture.seedSeconds.toFixed(3)+'s seed/initial verification'}.`);
        const evidence = { ...(campaign ? { candidate } : {}), ...(template?{template:templateEvidence}:{}), backendMemoryStopFraction, volume, backendId, runtime, baseline, preparationMethod: fixture.preparationMethod, seedSeconds: fixture.seedSeconds, identityHash: digest(fixture.users.map(u => u.id)), volumeRetained: true };
        // Persist preparation evidence before deleting its accounts; never publish credentials.
        json(`${directory}/trial-${trial}.json`, evidence);
        if (workload) {
          const workloadDirectory = mkdtempSync('results/social-');
          operation.workloadDirectory = workloadDirectory; savePrivate('.fixtures/operation.lock', operation);
          evidence.workload = { directory: workloadDirectory, report: null };
          json(`${directory}/trial-${trial}.json`, evidence);
          if (campaign || preparedSessions) { report.activeTrial = {...report.activeTrial,number:trial,workloadDirectory,volume:name}; json(`${directory}/report.json`, report); }
          const result = await runWorkload({ directory: workloadDirectory, config, configPath, fixture, baseline, runtime, operation, signal: cancellation.signal, interruption: () => interrupted, boundedRunner: true, campaign: !!campaign, runnerProfile, backendMemoryStopFraction });
          evidence.workload = { directory: workloadDirectory, report: result };
          if (campaign || hostSafety) {
            let measuredAt=null,pressure=null,cpuEvidenceInvalid=false;
            try {
              if (!preparedSessions || result.preparedEvidenceValid) {
                measuredAt=preparedSessions?result.phaseTiming.measurementAt:await measurementStart(`${workloadDirectory}/k6-metrics.json.gz`);
                const originals=readFileSync(`${workloadDirectory}/runner-cgroups.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
                pressure=campaignCpuPressure(originals,measuredAt,config.measurementSeconds);
              }
            } catch(error) {if(!preparedSessions)throw error;cpuEvidenceInvalid=true;}
            evidence.generatorCheck = {measurementStartedAt:measuredAt===null?null:new Date(measuredAt).toISOString(),sustainedCpuPressure:pressure,completeWindow:pressure!==null,headroom:'unverified'};
            if (campaign || preparedSessions) evidence.classification = cpuEvidenceInvalid?{verdict:'invalid',reasons:['measurement_cpu_window_evidence'],certified:false}:classifyCampaignTrial(result,preparedSessions&&!result.preparedEvidenceValid?{metrics:{}}:existsSync(`${workloadDirectory}/k6-summary.json`)?JSON.parse(readFileSync(`${workloadDirectory}/k6-summary.json`)):{metrics:{}},pressure);
          }
          json(`${directory}/trial-${trial}.json`, evidence);
          if (preparedSessions) {
            report.trials.push(evidence);delete report.activeTrial;
            if (!result.cleanupVerified||evidence.classification.verdict!=='pass'||!result.valid) throw Object.assign(new Error('Prepared single point invalid or failed; original evidence/used fixture retained'),{retainLock:result.cleanupVerified===false});
          }
          if (hostSafety) assert.equal(evidence.generatorCheck.sustainedCpuPressure, false, 'Stop sizing on measured generator CPU pressure; preserve private fixture');
          if (campaign) assert.ok(['pass', 'slo_failure'].includes(evidence.classification.verdict), 'Stop campaign on invalid/generator-limited evidence; preserve private fixture');
        }
        await deleteFixture(fixture, createClient, persist);
        const posts = (await createClient().records('posts').list({ pagination: { limit: 1 }, count: true })).total_count;
        assert.equal(posts, 0, 'API cleanup must leave zero public posts');
        evidence.apiReset = { posts }; json(`${directory}/trial-${trial}.json`, evidence);
        unlinkSync(fixturePath); if(!preparedSessions)report.trials.push(evidence);
        if (campaign) { delete report.activeTrial; report.search = next(report.trials); console.log(`Campaign trial ${trial}: ${evidence.classification.verdict}; API cleanup zero posts, volume retained.`); }
      } catch (error) { trialError = error; throw error; }
      finally {
        try {
          const ids = containerIds();
          assert.ok(ids.length <= 1, 'Refuse shutdown with unexpected project containers');
          if (ids.length) {
            backendId ??= ids[0];
            assertBaselineBackend(backendState(ids[0]), backendId, name);
          }
          assertBaselineVolume(volumeState(name), run, trial, campaign ? 8 : 3);
          try {
            if (ids.length) await capturePreparationEvidence(`${directory}/trial-${trial}`, backendId, `.fixtures/backend-logs/${run}-${trial}`);
          } finally { await compose(['down']); }
          assert.equal(containerIds().length, 0);
          if(template)await checkTemplate();
        } catch (error) {
          uncertain = true;
          if (!trialError) throw error;
          try { json(`${directory}/trial-${trial}.cleanup-failure.json`, { type: error.name, primaryType: trialError.name }); }
          catch { console.error('Secondary cleanup failure could not be recorded; primary error preserved, operation claim retained.'); }
        }
      }
      json(`${directory}/report.json`, report);
    }
    assert.equal(new Set(report.trials.map(t => t.identityHash)).size, campaign ? report.trials.length : plan.trials, 'Fresh native identities must differ');
    report.pilotVolumeAfter = pilotState(); assert.deepEqual(report.pilotVolumeAfter, report.pilotVolumeBefore);
    report.valid = !interrupted;
    console.log(`${campaign ? 'Campaign' : workload ? 'Fresh workload' : 'Baseline'} proof: ${directory}`);
  } catch (error) {
    uncertain ||= error.retainLock === true;
    if (workload && operation.workloadDirectory && interrupted) json(`${operation.workloadDirectory}/interruption.json`, { signal: interrupted, at: new Date().toISOString(), valid: false });
    json(`${directory}/failure.json`, { type: error.name, code: error.code ?? error.cause?.code ?? null, locations: error.stack?.split('\n').filter(line => /^\s+at /.test(line)), controllerRequest: error.controllerRequest ?? null, interrupted: interrupted ?? null });
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
