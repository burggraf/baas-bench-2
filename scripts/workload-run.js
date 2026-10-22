import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {controllerClient} from './client.js';
import {savePrivate} from '../src/fixtures.js';
import {summarize} from '../src/report.js';
import {summarizeAuth} from '../src/auth.js';
import {runnerBudget} from '../src/calibration-runner.js';
import {capture,hash,runRunner,execute} from './runtime.js';
import {startMonitor} from './monitor.js';
import {stopOwnedRunner} from './recovery.js';
import {campaignResourceStop,vmMemoryStop,assertHostMemoryCoverage} from '../src/campaign.js';

const json=(path,data)=>writeFileSync(path,JSON.stringify(data,null,2));
const storageBytes=()=>Number(capture('docker',['compose','exec','-T','trailbase','du','-sk','/app/traildepot']).split(/\s+/)[0])*1024;
export async function verifySizingHost(prefix,backendId) {
  assert.equal(process.platform,'darwin','Host-pressure guarded sizing requires macOS');
  const vm=await execute('docker',['exec',backendId,'cat','/proc/meminfo'],{timeout:2000,maxBuffer:1024*1024});
  const host=await execute('sysctl',['-n','kern.memorystatus_vm_pressure_level'],{timeout:2000,maxBuffer:1024*1024});
  json(`${prefix}.json`,{at:new Date().toISOString(),vm,host,policy:{liveVmReserveBytes:1073741824,prestartVmReserveBytes:4294967296*0.85+1073741824,requireZeroVmSwapUsed:true,normalMacosPressure:'1'}});
  assert.equal(vm.stderr,'');assert.equal(host.stderr,'');assert.equal(vmMemoryStop(vm.stdout,true),null,'Insufficient VM memory reserve or used VM swap');assert.equal(host.stdout.trim(),'1','macOS memory pressure is not normal');
}

async function endCounts(fixture,signal) {
  let posts=0,likes=0;
  for(const user of fixture.users) {
    const client=controllerClient(signal);
    try {
      await client.login(user.username,user.password);
      assert.equal(client.user()?.id,user.id,'End verification identity mismatch');
      posts+=(await client.records('posts').list({pagination:{limit:1},filters:[{column:'author',value:user.id}],count:true})).total_count;
      likes+=(await client.records('likes').list({pagination:{limit:1},count:true})).total_count;
    } finally {if(client.user())await client.logout();}
  }
  return {users:fixture.users.length,posts,likes};
}

// Both callers verify their deployment/volume before entering this shared, single-use runner lifecycle.
export async function runWorkload({directory,config,configPath,fixture,baseline,runtime,operation,signal,interruption=()=>null,authMode=null,boundedRunner=false,campaign=false,runnerProfile}) {
  const authCheck=authMode!==null,bundle=authCheck?'auth':'social',path='.fixtures/trailbase.json',id=directory.split('/').at(-1);
  assert.equal(fixture.status,'ready','Baseline is partial/used: reset/reseed before every trial');
  assert.deepEqual(fixture.config,config);
  capture('npm',['run','build']);
  assert.ok(!runnerProfile||boundedRunner,'Explicit profile requires bounded runner');
  const budget=boundedRunner?runnerBudget(id,runnerProfile):null,hostSafety=runnerProfile==='4cpu-4g',guarded=campaign||hostSafety;
  const backendId=capture('docker',['compose','ps','-q','trailbase']);
  if(hostSafety)await verifySizingHost(`${directory}/host-before-run`,backendId);
  const start={...baseline,storageBytes:storageBytes()};
  json(`${directory}/manifest.json`,{kind:authCheck?'native-sdk-auth-correctness':'fixed-vu-exploratory',...(authCheck?{mode:authMode}:{}),...(budget?{runnerBudget:budget,measurementPurpose:'full-workload-generator-sizing',...(runnerProfile?{runnerProfile,hostSafety:true}:{})}:{}),...runtime,config,hashes:{...runtime.hashes,[`dist/${bundle}.js`]:hash(`dist/${bundle}.js`)},fixtureHash:hash(path),seedSeconds:fixture.seedSeconds,preparation:fixture.preparation,baseline});
  json(`${directory}/fixtures.json`,{recipe:config.dataset,seed:config.seed,baseline,fixtureHash:hash(path)});
  json(`${directory}/config.json`,config);
  // Consume before launching: crashes/failed runs must never silently reuse a mutated baseline.
  fixture.status='used';savePrivate(path,fixture);
  const runnerName=`${id}-runner`;
  Object.assign(operation,{runId:id,runnerImageId:runtime.runnerImageId});savePrivate('.fixtures/operation.lock',operation);
  const guard=guarded?new AbortController():null;
  let safetyStop=null,observations=0;
  const watch=guarded?row=>{
    observations++;
    const reason=campaignResourceStop(row,budget.memoryBytes);
    if(reason&&!safetyStop){safetyStop={reason,at:row.at,role:row.role,type:row.type,valid:false,certified:false};json(`${directory}/resource-safety-stop.json`,safetyStop);guard.abort();}
  }:undefined;
  const monitor=await startMonitor(directory,backendId,runnerName,boundedRunner?`${directory}/runner-cgroups.jsonl`:undefined,watch,hostSafety);
  let status,resources;
  try {
    operation.monitorPid=monitor.pid;savePrivate('.fixtures/operation.lock',operation);
    const args=['run','--out',`json=/results/${id}/k6-metrics.json.gz`,'--summary-export',`/results/${id}/k6-summary.json`,`/scripts/${bundle}.js`];
    status=await runRunner(directory,'k6',boundedRunner?['node','/work/calibration-runner.js',id,...(runnerProfile?['--profile=4cpu-4g']:[]),...args]:['k6',...args],[...(authCheck?['-e',`AUTH_CHECK_MODE=${authMode}`]:[]),'--name',runnerName,'--label',`baas-bench-2.run=${id}`,'-v',`${resolve(path)}:/private/fixture.json:ro`,'-v',`${resolve(configPath)}:/config/run.json:ro`,...(boundedRunner?['-v',`${resolve('src/calibration-runner.js')}:/work/calibration-runner.js:ro`]:[])],{remove:false,signal:guard?AbortSignal.any([signal,guard.signal]):signal});
  } finally {
    let failure;
    try {await stopOwnedRunner(id,runtime.runnerImageId,{remove:false});}catch(error){failure=error;}
    try {resources=await monitor.stop();}catch(error){failure??=error;}
    try {json(`${directory}/runner-cleanup.json`,await stopOwnedRunner(id,runtime.runnerImageId));}catch(error){failure??=error;}
    if(guarded)json(`${directory}/campaign-guard.json`,{observations,stop:safetyStop,memoryStopFraction:0.85,...(hostSafety?{hostMemoryGuard:true,runnerProfile}:{})});
    if(failure)throw Object.assign(new Error('Run resource cleanup failed; inspect saved evidence and explicitly recover'),{retainLock:true});
  }
  if(safetyStop)throw Object.assign(new Error('Campaign resource safety stop; original evidence/private fixture retained'),{name:'CampaignSafetyStop'});
  if(budget) {
    const limits=readFileSync(`${directory}/runner-limits.txt`,'utf8').trim().split(/\s+/).map(Number);
    assert.equal(limits[0]/limits[1],budget.cpus);assert.equal(limits[2],budget.memoryBytes);assert.equal(limits[3],0);
    for(const boundary of ['first','last']){const policy=resources.containers.runner[boundary];assert.equal(policy.nanoCpus,budget.cpus*1e9);assert.equal(policy.memoryLimit,budget.memoryBytes);assert.equal(policy.memorySwap,budget.memoryBytes);}
  }
  if(hostSafety)assertHostMemoryCoverage(readFileSync(`${directory}/resources.jsonl`,'utf8').trim().split('\n').map(JSON.parse));
  const summary=JSON.parse(readFileSync(`${directory}/k6-summary.json`)),workload=authCheck?summarizeAuth(summary,config.vus,authMode):summarize(summary,config);
  const interrupted=interruption(),end=interrupted?null:{...await endCounts(fixture,signal),storageBytes:storageBytes()};
  const unchanged=!authCheck||(end?.posts===start.posts&&end?.likes===start.likes);
  const report={...workload,workloadValid:workload.valid,valid:!interrupted&&status===0&&workload.valid&&resources.valid&&unchanged,interrupted:interrupted??null,...(budget?{runnerBudget:budget}:{}),resources,exitStatus:status,start,end};
  if(authCheck)report.naturalExpiryCovered=report.valid&&workload.naturalExpiryCovered;
  json(`${directory}/report.json`,report);
  const lines=authCheck?['# Native SDK authentication correctness','','**Not a capacity/SLO/soak result.**','',`Mode: ${authMode}; valid: ${report.valid}; natural expiry covered: ${report.naturalExpiryCovered}.`,...report.limitations.map(l=>`- ${l}`)]:['# Exploratory fixed-VU smoke report','','**Not a capacity result.**','',`Dataset: ${config.dataset.profile}; VUs: ${config.vus}; measurement: ${config.measurementSeconds}s.`,`Workload validity: ${report.valid}; sample evidence: ${report.sloEvidence}; k6 exit: ${status}.`,'','| Action | Completed | Failed | Observed % | p95 ms | SLO evidence |','|---|---:|---:|---:|---:|---|',...Object.entries(report.actions).map(([name,a])=>`| ${name} | ${a.count} | ${a.failures} | ${a.observedPercent.toFixed(2)} | ${a.p95Ms??'n/a'} | ${a.slo} |`),'',`Posts: ${report.start.posts} -> ${report.end?.posts??'unavailable'}; likes: ${report.start.likes} -> ${report.end?.likes??'unavailable'}.`,'',...report.limitations.map(l=>`- ${l}`),`- Resource evidence valid: ${resources.valid}; stability: ${resources.stability}; generator headroom: ${resources.generatorHeadroom}.`,...resources.issues.map(issue=>`- Resource issue: ${issue}`),...resources.limitations.map(l=>`- ${l}`),'- Natural token expiry not certified.'];
  writeFileSync(`${directory}/report.md`,lines.join('\n')+'\n');
  console.log(`${authCheck?'Authentication':'Workload'} evidence: ${directory}; not capacity certification.`);
  if(!campaign){
    assert.equal(status,0,'k6 thresholds/execution failed; original evidence retained');
    assert.ok(report.valid,'Workload validity failed; inspect report and raw metrics');
  }
  return report;
}
