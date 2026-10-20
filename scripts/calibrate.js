import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { capture, hash, runRunner } from './runtime.js';
import { startMonitor } from './monitor.js';
import { savePrivate } from '../src/fixtures.js';
import { assertCalibrationContainer, summarizeCalibration } from '../src/calibration.js';

const project='baas-bench-2-calibration',pilot='baas-bench-2-pilot';
const json=(path,data)=>writeFileSync(path,JSON.stringify(data,null,2));
const ids=()=>capture('docker',['ps','-aq','--filter',`label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean);
const inspect=id=>JSON.parse(capture('docker',['inspect',id]))[0];
const pilotVolume=()=>{
  const name=`${pilot}_trailbase-data`;
  if(!capture('docker',['volume','ls','--format','{{.Name}}']).split('\n').includes(name))return null;
  const v=JSON.parse(capture('docker',['volume','inspect',name]))[0];return {Name:v.Name,CreatedAt:v.CreatedAt,Driver:v.Driver,Labels:v.Labels};
};

async function main() {
  const args=process.argv.slice(2);assert.ok(args.length===0||(args.length===1&&args[0]==='--smoke'),'Usage: node scripts/calibrate.js [--smoke]');
  const smoke=args.length===1,rates=smoke?[10,40]:[25,100,400,1600],seconds=smoke?6:20,warmup=smoke?2:5;
  assert.ok(!process.env.COMPOSE_FILE&&!process.env.COMPOSE_PROJECT_NAME&&!process.env.DOCKER_HOST&&!process.env.CALIBRATION_RUN&&!process.env.CALIBRATION_RESULTS,'Refuse environment overrides');
  assert.match(capture('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^unix:\/\//,'Local Docker only');
  for(const p of [pilot,project])assert.equal(capture('docker',['ps','-aq','--filter',`label=com.docker.compose.project=${p}`]),'','Stop/inspect existing project containers first');
  assert.equal(capture('docker',['network','ls','-q','--filter',`label=com.docker.compose.project=${project}`]),'','Inspect leftover calibration network first');
  assert.ok(!existsSync('.fixtures/trailbase.json')&&!existsSync('.fixtures/recovery.lock'),'Resolve fixture/recovery claim first');
  const image=capture('docker',['image','inspect','baas-bench-2-pilot-runner','--format','{{.Id}}']);
  assert.equal(capture('docker',['image','inspect',image,'--format','{{.Os}}/{{.Architecture}}']),'linux/arm64','This local calibration is ARM64 only');
  mkdirSync('results',{recursive:true});const directory=mkdtempSync('results/calibration-'),run=directory.split('/').at(-1);
  const operation={version:1,pid:process.pid,command:'calibration',runId:run,project,runnerImageId:image,startedAt:new Date().toISOString()};
  savePrivate('.fixtures/operation.lock',operation,true);
  Object.assign(process.env,{COMPOSE_FILE:resolve('compose.calibration.yaml'),COMPOSE_PROJECT_NAME:project,CALIBRATION_RUN:run,CALIBRATION_RESULTS:resolve(directory)});
  const cancellation=new AbortController();let interrupted,uncertain=false,monitor;
  const handlers=Object.fromEntries(['SIGINT','SIGTERM'].map(s=>[s,()=>{interrupted??=s;cancellation.abort();}]));
  for(const [s,h]of Object.entries(handlers))process.on(s,h);
  const report={kind:'synthetic-read-only-sdk-calibration',valid:false,certified:false,generatorHeadroom:'unverified',smoke,rates,seconds,warmup,preAllocatedVUs:32,maxVUs:32,pilotVolumeBefore:pilotVolume(),trials:[],limitations:[
    'Open arrival-rate iterations are not concurrent active users; this is not the social workload or BaaS capacity.',
    'Static uncompressed 20-post pages exercise official SDK/query/transport/JSON/validation cost only; no auth, writes, sessions, target search or database.',
    'Non-HTTP time includes connection/queueing, SDK processing, validation and millisecond timer quantization; it is not isolated SDK cost. Never subtract percentiles.',
    'Target and runner share the same M1/OrbStack host; target, VM, thermal, VU allocation and raw-output/monitoring limits can constrain delivery.',
    'A Node OS-only supervisor captures runner cgroups including final counters; its cost shares the runner budget. All API traffic remains direct SDK/k6, not a Node bridge.',
    'Short bounded calibration is descriptive only; larger/separate-runner confirmation near a real boundary remains required.'
  ]};
  const compose=async args=>{
    try{const r=await promisify(execFile)('docker',['compose',...args],{timeout:30000,maxBuffer:1024*1024});appendFileSync(`${directory}/docker-stdout.log`,r.stdout);appendFileSync(`${directory}/docker-stderr.log`,r.stderr);}
    catch(e){appendFileSync(`${directory}/docker-stdout.log`,e.stdout??'');appendFileSync(`${directory}/docker-stderr.log`,e.stderr??'');throw e;}
  };
  const owned=()=>ids().map(id=>{const s=inspect(id);assertCalibrationContainer(s,run,image);return s;});
  try {
    const paths=['runner/Dockerfile','compose.calibration.yaml','package.json','package-lock.json','scripts/build.js','scripts/calibrate.js','scripts/monitor.js','scripts/runtime.js','src/calibration.js','src/calibration-target.js','src/calibration-runner.js','src/workload.js','src/k6/calibration.js','src/k6/transport.js','dist/calibration.js'];
    json(`${directory}/manifest.json`,{kind:report.kind,revision:capture('git',['rev-parse','HEAD']),dirty:!!capture('git',['status','--porcelain']),startedAt:operation.startedAt,controllerNode:process.version,host:{platform:platform(),arch:arch(),release:release(),cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,memoryBytes:totalmem()},imageId:image,platform:'linux/arm64',sdkVersion:JSON.parse(readFileSync('package-lock.json')).packages['node_modules/trailbase'].version,docker:JSON.parse(capture('docker',['info','--format','{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}},"kernel":{{json .KernelVersion}}}'])),hashes:Object.fromEntries(paths.map(p=>[p,hash(p)]))});
    cancellation.signal.throwIfAborted();await compose(['up','-d','--wait','target']);cancellation.signal.throwIfAborted();
    const target=owned().find(s=>s.Config.Labels['com.docker.compose.service']==='target');assert.ok(target);
    assert.deepEqual(target.HostConfig.PortBindings,{});assert.equal(target.HostConfig.NanoCpus,1e9);assert.equal(target.HostConfig.Memory,268435456);assert.equal(target.HostConfig.MemorySwap,268435456);
    const targetLimits=capture('docker',['exec',target.Id,'sh','-c','cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max']).split(/\s+/).map(Number);
    assert.deepEqual(targetLimits,[100000,100000,268435456,0]);json(`${directory}/target-limits.json`,{cpu:targetLimits.slice(0,2),memory:targetLimits[2],swap:targetLimits[3],imageId:target.Image});
    operation.targetId=target.Id;savePrivate('.fixtures/operation.lock',operation);
    for(const rate of rates) {
      cancellation.signal.throwIfAborted();const id=`${run}-${rate}`,dir=`${directory}/${id}`,name=`${id}-runner`;mkdirSync(dir);
      monitor=await startMonitor(dir,target.Id,name,`${dir}/runner-cgroups.jsonl`);operation.monitorPid=monitor.pid;operation.runnerName=name;savePrivate('.fixtures/operation.lock',operation);
      const status=await runRunner(dir,'k6',['node','/work/calibration-runner.js',id,'run','--summary-export',`/results/${id}/k6-summary.json`,'--out',`json=/results/${id}/k6-metrics.json.gz`,'/scripts/calibration.js'],['--no-deps','--name',name,'--label',`baas-bench-2.run=${id}`,'-e',`CALIBRATION_RATE=${rate}`,'-e',`CALIBRATION_SECONDS=${seconds}`,'-e',`CALIBRATION_WARMUP=${warmup}`],{remove:false,signal:cancellation.signal});
      const resources=await monitor.stop();monitor=undefined;
      const runner=owned().find(s=>s.Name===`/${name}`);assert.ok(runner);assert.equal(runner.HostConfig.NanoCpus,2e9);assert.equal(runner.HostConfig.Memory,1073741824);assert.equal(runner.HostConfig.MemorySwap,1073741824);
      const limits=readFileSync(`${dir}/runner-limits.txt`,'utf8').trim().split(/\s+/).map(Number);
      assert.equal(limits.length,4);assert.equal(limits[0]/limits[1],2);assert.equal(limits[2],1073741824);assert.equal(limits[3],0);
      cancellation.signal.throwIfAborted();assert.equal(status,0,'Inspect failed k6 evidence; no automatic retry');
      const trial={id,...summarizeCalibration(JSON.parse(readFileSync(`${dir}/k6-summary.json`)),rate,seconds,resources)};report.trials.push(trial);json(`${directory}/report.json`,report);
      assert.ok(trial.valid,'Invalid SDK/resource evidence; stop calibration');
      capture('docker',['rm',runner.Id]);
    }
    report.pilotVolumeAfter=pilotVolume();assert.deepEqual(report.pilotVolumeAfter,report.pilotVolumeBefore);
    report.valid=report.trials.length===rates.length&&report.trials.every(t=>t.valid);
  } catch(e) {report.valid=false;json(`${directory}/failure.json`,{name:e.name,interrupted:interrupted??null});throw e;}
  finally {
    try {
      for(const s of owned())if(s.Config.Labels['com.docker.compose.service']==='runner'&&s.State.Running)capture('docker',['stop','--signal','SIGINT','--time','10',s.Id]);
      if(monitor)await monitor.stop();
      for(const s of owned())if(s.Config.Labels['com.docker.compose.service']==='runner'){assert.equal(s.State.Running,false);capture('docker',['rm',s.Id]);}
      for(const id of capture('docker',['network','ls','-q','--filter',`label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean))assert.equal(JSON.parse(capture('docker',['network','inspect',id]))[0].Labels['baas-bench-2.run'],run);
      await compose(['down','--timeout','10']);assert.equal(ids().length,0);
    } catch {uncertain=true;report.valid=false;}
    json(`${directory}/report.json`,report);
    if(!uncertain)unlinkSync('.fixtures/operation.lock');
    for(const[s,h]of Object.entries(handlers))process.removeListener(s,h);
    if(interrupted)process.exitCode=interrupted==='SIGINT'?130:143;
    assert.ok(!uncertain,'Uncertain cleanup: retain lock and inspect exact calibration resources manually');
  }
  console.log(`Calibration evidence: ${directory}; generator headroom remains unverified.`);
}
try {await main();}catch(e){console.error(`Calibration failed (${e.name}); inspect retained evidence/lock, never retry blindly.`);process.exitCode||=1;}
