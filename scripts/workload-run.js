import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {controllerClient} from './client.js';
import {savePrivate} from '../src/fixtures.js';
import {summarize} from '../src/report.js';
import {summarizeAuth} from '../src/auth.js';
import {runnerBudget} from '../src/calibration-runner.js';
import {capture,hash,runRunner,execute,captureHostMemory} from './runtime.js';
import {startMonitor} from './monitor.js';
import {stopOwnedRunner} from './recovery.js';
import {campaignResourceStop,vmMemoryStop,assertHostMemoryCoverage,prestartMemoryReserve} from '../src/campaign.js';

const json=(path,data)=>writeFileSync(path,JSON.stringify(data,null,2));
const storageBytes=(service,dataPath)=>Number(capture('docker',['compose','exec','-T',service,'du','-sk',dataPath]).split(/\s+/)[0])*1024;
export async function verifySizingHost(prefix,backendId,runnerMemoryBytes=4294967296) {
  const vm=await execute('docker',['exec',backendId,'cat','/proc/meminfo'],{timeout:2000,maxBuffer:1024*1024});
  const host=await captureHostMemory();
  json(`${prefix}.json`,{at:new Date().toISOString(),vm,host,policy:{liveVmReserveBytes:1073741824,prestartVmReserveBytes:prestartMemoryReserve(runnerMemoryBytes),requireZeroVmSwapUsed:true,...(host.platform==='darwin'?{normalMacosPressure:'1'}:{hostMemorySource:'/proc/meminfo'})}});
  assert.equal(vm.stderr,'');assert.equal(host.stderr,'');assert.equal(vmMemoryStop(vm.stdout,true,runnerMemoryBytes),null,'Insufficient VM memory reserve or used VM swap');
  if(host.platform==='linux')assert.equal(vmMemoryStop(host.stdout,true,runnerMemoryBytes),null,'Insufficient host memory reserve or used host swap');
  else assert.equal(host.stdout.trim(),'1','macOS memory pressure is not normal');
}

async function endCounts(fixture,signal,createClient) {
  let posts=0,likes=0;
  for(const user of fixture.users) {
    const client=createClient(signal);
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
export async function runWorkload({directory,config,configPath,fixture,baseline,runtime,operation,signal,interruption=()=>null,authMode=null,boundedRunner=false,campaign=false,runnerProfile,backendMemoryStopFraction=0.85,service='trailbase',dataPath='/app/traildepot',fixturePath='.fixtures/trailbase.json',createClient=controllerClient}) {
  const prepared=config.version==='social-prepared-v1';
  assert.ok(!prepared||authMode===null&&boundedRunner&&runnerProfile==='4cpu-16g'&&backendMemoryStopFraction===0.85,'Prepared sessions require the normal bounded single-point profile');
  const authCheck=authMode!==null,bundle=authCheck?'auth':'social',path=fixturePath,id=directory.split('/').at(-1);
  assert.equal(fixture.status,'ready','Baseline is partial/used: reset/reseed before every trial');
  assert.deepEqual(fixture.config,config);
  capture('npm',['run','build']);
  assert.ok(!runnerProfile||boundedRunner,'Explicit profile requires bounded runner');
  assert.ok(backendMemoryStopFraction===0.85||(backendMemoryStopFraction===0.95&&runnerProfile==='4cpu-16g'&&campaign),'Backend95 requires the explicit16GiB campaign');
  const budget=boundedRunner?runnerBudget(id,runnerProfile):null,hostSafety=runnerProfile!==undefined,guarded=campaign||hostSafety;
  const backendId=capture('docker',['compose','ps','-q',service]);
  if(hostSafety)await verifySizingHost(`${directory}/host-before-run`,backendId,budget.memoryBytes);
  const start={...baseline,storageBytes:storageBytes(service,dataPath)};
  json(`${directory}/manifest.json`,{backendMemoryStopFraction,kind:authCheck?'native-sdk-auth-correctness':prepared?'prepared-session-fixed-vu-exploratory':'fixed-vu-exploratory',...(prepared?{workloadVersion:config.version,gateProtocol:'loopback-prepared-v1',authPreparation:{...config.authPreparation,concurrency:1,retries:0},applicationClock:'common-release',nativeTokenClock:'original-preparation-login'}:{}),...(authCheck?{mode:authMode}:{}),...(budget?{runnerBudget:budget,measurementPurpose:prepared?'prepared-session-application-point':'full-workload-generator-sizing',...(runnerProfile?{runnerProfile,hostSafety:true}:{})}:{}),...runtime,config,hashes:{...runtime.hashes,[`dist/${bundle}.js`]:hash(`dist/${bundle}.js`)},fixtureHash:hash(path),preparationMethod:fixture.preparationMethod,seedSeconds:fixture.seedSeconds,preparation:fixture.preparation,baseline});
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
    const reason=campaignResourceStop(row,budget.memoryBytes,backendMemoryStopFraction);
    if(reason&&!safetyStop){safetyStop={reason,at:row.at,role:row.role,type:row.type,valid:false,certified:false};json(`${directory}/resource-safety-stop.json`,safetyStop);guard.abort();}
  }:undefined;
  const monitor=await startMonitor(directory,backendId,runnerName,boundedRunner?`${directory}/runner-cgroups.jsonl`:undefined,watch,hostSafety);
  let status,resources,executionFailed=false,cleanupVerified=true;
  try {
    operation.monitorPid=monitor.pid;savePrivate('.fixtures/operation.lock',operation);
    const args=['run','--out',`json=/results/${id}/k6-metrics.json.gz`,'--summary-export',`/results/${id}/k6-summary.json`,`/scripts/${bundle}.js`];
    status=await runRunner(directory,'k6',boundedRunner?['node','/work/calibration-runner.js',id,...(runnerProfile?[`--profile=${runnerProfile}`]:[]),...(prepared?['--prepared-sessions']:[]),...args]:['k6',...args],[...(authCheck?['-e',`AUTH_CHECK_MODE=${authMode}`]:[]),'--name',runnerName,'--label',`baas-bench-2.run=${id}`,'-v',`${resolve(path)}:/private/fixture.json:ro`,'-v',`${resolve(configPath)}:/config/run.json:ro`,...(boundedRunner?['-v',`${resolve('src/calibration-runner.js')}:/work/calibration-runner.js:ro`]:[]),...(prepared?['-v',`${resolve('src/prepared-gate.js')}:/work/prepared-gate.js:ro`,'-v',`${resolve('src/workload.js')}:/work/workload.js:ro`]:[])],{remove:false,signal:guard?AbortSignal.any([signal,guard.signal]):signal});
  } catch(error) {
    if(!prepared)throw error;
    executionFailed=true;
  } finally {
    let failure;
    try {await stopOwnedRunner(id,runtime.runnerImageId,{remove:false});}catch(error){failure=error;}
    try {resources=await monitor.stop();}catch(error){failure??=error;}
    try {json(`${directory}/runner-cleanup.json`,await stopOwnedRunner(id,runtime.runnerImageId));}catch(error){failure??=error;}
    if(guarded)json(`${directory}/campaign-guard.json`,{observations,stop:safetyStop,memoryStopFraction:0.85,backendMemoryStopFraction,...(hostSafety?{hostMemoryGuard:true,runnerProfile}:{})});
    if(failure){
      if(!prepared)throw Object.assign(new Error('Run resource cleanup failed; inspect saved evidence and explicitly recover'),{retainLock:true});
      cleanupVerified=false;
      resources={...(resources??{}),valid:false,issues:[...(resources?.issues??[]),'cleanup_unverified'],limitations:resources?.limitations??[],stability:'unknown',generatorHeadroom:'unverified'};
    }
  }
  if(safetyStop&&!prepared)throw Object.assign(new Error('Campaign resource safety stop; original evidence/private fixture retained'),{name:'CampaignSafetyStop'});
  try {
  if(budget) {
    const limits=readFileSync(`${directory}/runner-limits.txt`,'utf8').trim().split(/\s+/).map(Number);
    assert.equal(limits[0]/limits[1],budget.cpus);assert.equal(limits[2],budget.memoryBytes);assert.equal(limits[3],0);
    for(const boundary of ['first','last']){const policy=resources.containers.runner[boundary];assert.equal(policy.nanoCpus,budget.cpus*1e9);assert.equal(policy.memoryLimit,budget.memoryBytes);assert.equal(policy.memorySwap,budget.memoryBytes);}
  }
  if(hostSafety)assertHostMemoryCoverage(readFileSync(`${directory}/resources.jsonl`,'utf8').trim().split('\n').map(JSON.parse),budget.memoryBytes);
  } catch(error) {
    if(!prepared)throw error;
    resources={...resources,valid:false,issues:[...(resources.issues??[]),'runner_policy_or_host_evidence']};
  }
  let nativeChildExit=null;
  if(prepared)try{
    const child=JSON.parse(readFileSync(`${directory}/runner-child-exit.json`));
    assert.ok((child.code===null||Number.isInteger(child.code))&&(child.signal===null||/^SIG[A-Z]+$/.test(child.signal))&&typeof child.spawnFailed==='boolean');
    nativeChildExit={code:child.code,signal:child.signal,spawnFailed:child.spawnFailed};
    if(child.spawnFailed)executionFailed=true;
  }catch{executionFailed=true;}
  const evidence=prepared?await (await import('../src/prepared-evidence.js')).reconcilePrepared(directory,config):null;
  let summary;
  try {summary=JSON.parse(readFileSync(`${directory}/k6-summary.json`));}
  catch(error){if(!prepared)throw error;summary=null;evidence.valid=false;evidence.issues.push('missing_or_invalid_summary');}
  const workload=authCheck?summarizeAuth(summary,config.vus,authMode):summarize(summary,config,evidence);
  let interrupted=interruption(),end=null;
  const skipEnd=interrupted||prepared&&(!workload.valid||!evidence.valid||executionFailed||!cleanupVerified||safetyStop||!resources.valid||![0,99].includes(status));
  if(!skipEnd)try{end={...await endCounts(fixture,signal,createClient),storageBytes:storageBytes(service,dataPath)};}
  catch(error){if(!prepared)throw error;executionFailed=true;interrupted=interruption();}
  const unchanged=!authCheck||(end?.posts===start.posts&&end?.likes===start.likes);
  const report={...workload,workloadValid:workload.valid,valid:!interrupted&&status===0&&workload.valid&&resources.valid&&unchanged&&cleanupVerified&&!executionFailed&&!safetyStop,...(prepared?{cleanupVerified,executionFailed,safetyStop,nativeChildExit}:{}),interrupted:interrupted??null,...(budget?{runnerBudget:budget}:{}),resources,exitStatus:status??null,start,end};
  if(authCheck)report.naturalExpiryCovered=report.valid&&workload.naturalExpiryCovered;
  json(`${directory}/report.json`,report);
  const lines=authCheck?['# Native SDK authentication correctness','','**Not a capacity/SLO/soak result.**','',`Mode: ${authMode}; valid: ${report.valid}; natural expiry covered: ${report.naturalExpiryCovered}.`,...report.limitations.map(l=>`- ${l}`)]:[prepared?'# Exploratory prepared-session application report':'# Exploratory fixed-VU smoke report','','**Not a capacity result.**','',`Dataset: ${config.dataset.profile}; VUs: ${config.vus}; measurement: ${config.measurementSeconds}s.`,`Workload validity: ${report.valid}; sample evidence: ${report.sloEvidence}; k6 exit: ${status}.`,'','| Action | Completed | Failed | Observed % | p95 ms | SLO evidence |','|---|---:|---:|---:|---:|---|',...Object.entries(report.actions).map(([name,a])=>`| ${name} | ${a.count} | ${a.failures} | ${a.observedPercent.toFixed(2)} | ${a.p95Ms??'n/a'} | ${a.slo} |`),'',`Posts: ${report.start.posts} -> ${report.end?.posts??'unavailable'}; likes: ${report.start.likes} -> ${report.end?.likes??'unavailable'}.`,'',...(prepared?[`- Preparation: ${report.preparation.status}; ready users: ${report.preparation.readyUsers??'unavailable'}; measured users: ${report.participation?.measuredUsers??'unavailable'}.`,`- Measured login tails: ${report.authenticationEvidence.login.state}; refresh: ${report.authenticationEvidence.refresh.state}.`]:[]),...report.limitations.map(l=>`- ${l}`),`- Resource evidence valid: ${resources.valid}; stability: ${resources.stability}; generator headroom: ${resources.generatorHeadroom}.`,...resources.issues.map(issue=>`- Resource issue: ${issue}`),...resources.limitations.map(l=>`- ${l}`),'- Natural token expiry not certified.'];
  writeFileSync(`${directory}/report.md`,lines.join('\n')+'\n');
  console.log(`${authCheck?'Authentication':'Workload'} evidence: ${directory}; not capacity certification.`);
  if(!campaign&&!prepared){
    assert.equal(status,0,'k6 thresholds/execution failed; original evidence retained');
    assert.ok(report.valid,'Workload validity failed; inspect report and raw metrics');
  }
  return report;
}
