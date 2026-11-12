import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,unlinkSync,watch} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {hash,capture} from '../scripts/runtime.js';
import {savePrivate} from '../src/fixtures.js';

const read=p=>JSON.parse(readFileSync(p));
const trailbasePayloadCache=process.env.PREPARED_TEST_PAYLOAD_CACHE;assert.ok(trailbasePayloadCache===undefined||['320m','480m'].includes(trailbasePayloadCache));
const trailbaseRunnerWorkers=process.env.PREPARED_TEST_RUNNER_WORKERS;assert.ok(trailbaseRunnerWorkers===undefined||trailbaseRunnerWorkers==='2');
const trailbaseRunnerMemory=process.env.PREPARED_TEST_RUNNER_MEMORY??'16g';assert.ok(['16g','20g','48g'].includes(trailbaseRunnerMemory));
const trailbaseRunnerGc=process.env.PREPARED_TEST_RUNNER_GC;assert.ok(trailbaseRunnerGc===undefined||trailbaseRunnerGc==='150');
const trailbaseRunnerCpus=Number(process.env.PREPARED_TEST_RUNNER_CPUS??6);assert.ok([6,7,8,9].includes(trailbaseRunnerCpus));
for(const backend of ['trailbase','pocketbase'])for(const mode of ['success','failed-login','cancel-preparation','cancel-measurement',...(backend==='trailbase'?['boundary-delay']:[])])test(`prepared ${backend} ${mode}`,{timeout:180000},async()=>{
  assert.match(process.cwd(),/\/\.fixtures\/prepared-(native|regression)-[A-Za-z0-9-]+$/,'Run native tests only in a fresh isolated validation workspace');
  const controller=backend==='trailbase'?'baseline':'pocketbase',fixturePath=`.fixtures/${backend}.json`;
  assert.equal(existsSync(fixturePath),false);
  const source=readFileSync('src/k6/social.js','utf8'),needle='await client.login(user.username, user.password);';
  if(mode==='failed-login'){
    assert.equal(source.split(needle).length,2,'Fault injection must modify exactly one SDK login site');
    writeFileSync('src/k6/social.js',source.replace(needle,"await client.login(user.username, currentPhase === 'preparation' && exec.vu.idInTest === 2 ? user.password + 'incorrect' : user.password);"));
  }
  if(mode==='boundary-delay'){const mark='const tags = { action, phase: currentPhase };';assert.equal(source.split(mark).length,2);writeFileSync('src/k6/social.js',source.replace(mark,mark+"\n      if(prepared && exec.vu.idInTest===1 && actionSequence===0 && currentPhase==='ramp') sleep(Math.max(0,(applicationStart+config.rampSeconds*1000+102-Date.now())/1000));"));}
  execFileSync('npm',['run','build'],{stdio:'pipe'});
  const logs=mkdtempSync('results/prepared-native-');
  if(mode==='failed-login')writeFileSync(logs+'/fault.json',JSON.stringify({kind:'test-only wrong password for prepared VU2',sourceHash:hash('src/k6/social.js')}));
  const child=spawn(process.execPath,[`scripts/${controller}.js`,'--prepared-sessions','--smoke',...(backend==='trailbase'?[`--runner-cpus=${trailbaseRunnerCpus}`,...(trailbaseRunnerMemory!=='16g'?[`--runner-memory=${trailbaseRunnerMemory}`]:[]),...(trailbaseRunnerGc?['--runner-gc=150']:[]),...(trailbaseRunnerWorkers?['--runner-workers=2']:[]),...(trailbasePayloadCache?[`--payload-cache=${trailbasePayloadCache}`]:[])]:[])],{stdio:['ignore','pipe','pipe']});
  let stdout='',credentials=[],workload,signalled=false,signalTimer;
  const observe=()=>{
    try{
      if(existsSync(fixturePath))credentials=read(fixturePath).users;
      const operation=read('.fixtures/operation.lock');workload=operation.workloadDirectory;
      if(!workload||signalled||!mode.startsWith('cancel-'))return;
      const rows=readFileSync(workload+'/prepared-gate.jsonl','utf8').trim().split('\n').map(JSON.parse);
      if(mode==='cancel-preparation'&&rows.some(r=>r.event==='ready')){signalled=true;child.kill('SIGTERM');}
      const release=rows.find(r=>r.event==='released');
      if(mode==='cancel-measurement'&&release&&!signalTimer){const c=read(workload+'/config.json');signalTimer=setTimeout(()=>{signalled=true;child.kill('SIGTERM');},Math.max(1,release.releaseAt+(c.rampSeconds+c.warmupSeconds)*1000+1000-Date.now()));}
    }catch{}
  };
  const fixtureWatch=watch('.fixtures',observe),resultWatch=watch('results',{recursive:true},observe);
  child.stdout.on('data',b=>{stdout+=b;appendFileSync(logs+'/stdout.log',b);});child.stderr.on('data',b=>{stdout+=b;appendFileSync(logs+'/stderr.log',b);});
  const timeout=setTimeout(()=>child.kill('SIGTERM'),150000);
  let code;
  try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
  finally{clearTimeout(timeout);clearTimeout(signalTimer);fixtureWatch.close();resultWatch.close();if(['failed-login','boundary-delay'].includes(mode)){writeFileSync('src/k6/social.js',source);execFileSync('npm',['run','build'],{stdio:'pipe'});}}
  assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(capture('docker',['network','ls','-q','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(existsSync('.fixtures/operation.lock'),false);
  const directory=stdout.match(/(?:Baseline proof failed \([^\n]*?; inspect |Fresh workload proof: |PocketBase evidence: )(results\/(?:baseline|pocketbase)-[A-Za-z0-9]{6})/)?.[1];
  assert.ok(directory,`Missing controller pointer; inspect ${logs}`);
  if(!workload){const pointer=controller==='baseline'?read(directory+'/trial-1.json').workload:read(directory+'/point-2/workload.json');workload=pointer.directory;}
  assert.ok(workload);
  const manifest=read(workload+'/manifest.json');
  assert.equal(manifest.payloadCache.sha256,hash(workload+'/payload-cache.json'));
  assert.equal(manifest.hashes[workload+'/payload-cache.json'],manifest.payloadCache.sha256);
  assert.equal(manifest.payloadCache.recipe.users,2);
  if(backend==='trailbase'&&trailbasePayloadCache){assert.equal(manifest.payloadCache.recipe.budgetBytes,Number(trailbasePayloadCache.slice(0,-1))*1024*1024);assert.equal(manifest.payloadCache.recipe.version,'deterministic-post-cache-v2');}
  for(const input of ['src/payload-cache.js','src/k6/payload-cache.js','scripts/payload-cache.js'])assert.equal(manifest.hashes[input],hash(input));
  if(['success','boundary-delay'].includes(mode)){
    assert.equal(code,0,`Inspect ${logs}`);const r=read(workload+'/report.json');
    assert.equal(r.kind,'prepared-session-fixed-vu-exploratory');assert.equal(r.valid,true);assert.equal(r.preparedEvidenceValid,true);
    assert.equal(r.preparation.readyUsers,2);assert.equal(r.preparation.loginAttempts,2);assert.equal(r.preparation.protectedReadSuccesses,2);
    assert.equal(r.authenticationEvidence.phases.ramp.login.attempts,0);assert.equal(r.authenticationEvidence.phases.warmup.login.attempts,0,'Active session age starts at activation, not preparation login');
    assert.equal(r.preparation.ttlSeconds===null,backend==='pocketbase');assert.equal(r.preparation.nativeTtlKnownUsers,backend==='pocketbase'?0:2);
    assert.equal(r.participation.measuredUsers,2);assert.equal(r.participation.completedUsers,2);
    assert.equal(r.phaseTiming.endAt-r.phaseTiming.measurementAt,12000);assert.equal(r.authFailures,0);
    assert.equal(r.traffic.controlRequests,4);assert.equal(r.traffic.controlFailureRate,0);
    for(const a of Object.values(r.actions)){assert.ok(a.count>0);assert.equal(a.failures,0);}
    assert.equal(r.resources.containers.backend.first.nanoCpus,1e9);for(const boundary of ['first','last']){const policy=r.resources.containers.runner[boundary];if(backend==='trailbase'&&trailbaseRunnerCpus===9){assert.equal(policy.nanoCpus,0);assert.equal(policy.cpuQuota,900000);assert.equal(policy.cpuPeriod,100000);}else assert.equal(policy.nanoCpus,backend==='trailbase'?trailbaseRunnerCpus*1e9:4e9);}assert.equal(r.resources.containers.runner.first.memoryLimit,backend==='trailbase'&&trailbaseRunnerMemory==='48g'?51539607552:backend==='trailbase'&&trailbaseRunnerMemory==='20g'?21474836480:17179869184);
    if(backend==='trailbase'&&trailbaseRunnerGc){const expected={GOGC:'150',GOMEMLIMIT:trailbaseRunnerMemory==='48g'?'36GiB':trailbaseRunnerMemory==='20g'?'15GiB':'12GiB',...(trailbaseRunnerCpus===9?{GOMAXPROCS:'9'}:{})};assert.deepEqual(read(workload+'/runner-gc.json'),{profile:`${trailbaseRunnerCpus}cpu-${trailbaseRunnerMemory}`,gc:150,environment:expected,childInheritsEnvironment:!trailbaseRunnerWorkers,...(trailbaseRunnerWorkers?{workerEnvironment:{GOGC:'150',GOMEMLIMIT:'18GiB',GOMAXPROCS:'4'}}:{})});assert.deepEqual(r.runnerGcEnvironment,expected);assert.equal(r.runnerGc,150);assert.deepEqual(read(workload+'/manifest.json').runnerGcEnvironment,expected);}
    if(backend==='trailbase'&&trailbaseRunnerWorkers){const topology=read(workload+'/worker-topology.json');assert.equal(topology.workers,2);assert.equal(topology.sharedGate,true);assert.equal(read(workload+'/worker-merge.json').rawCountsVerified,true);assert.equal(r.nativeChildExit.workers.length,2);assert.ok(r.nativeChildExit.workers.every(w=>w.code===0));}
    if(mode==='boundary-delay'){const points=gunzipSync(readFileSync(workload+'/k6-metrics.json.gz')).toString().trim().split('\n').map(JSON.parse);const start=points.find(p=>p.type==='Point'&&p.metric==='prepared_action_start'&&p.data.metadata?.ordinal==='1'&&p.data.metadata?.sequence==='1');const rampEnd=r.phaseTiming.releaseAt+1000;assert.equal(start.data.tags.phase,'ramp');assert.ok(start.data.value<rampEnd);assert.ok(Date.parse(start.data.time)>=rampEnd+100);}
    assert.equal(existsSync(fixturePath),false,'Successful point cleans only its test-owned fixture');
  }else{
    assert.notEqual(code,0);const fixture=read(fixturePath);assert.equal(fixture.status,'used');
    if(mode==='failed-login'){
      const r=read(workload+'/report.json');assert.equal(r.valid,false);assert.equal(r.preparation.status,'failed');assert.equal(r.preparation.reason,'auth_failed');assert.equal(r.end,null);
      const result=controller==='baseline'?read(directory+'/trial-1.json').classification:read(directory+'/point-2/result.json');assert.equal(result.verdict,'invalid');assert.ok(result.reasons.includes('auth_preparation_failed'));
    }else assert.equal(signalled,true);
    const archive=`.fixtures/archive/${directory.split('/').at(-1)}-${mode}.json`;savePrivate(archive,fixture,true);assert.equal(hash(archive),hash(fixturePath));unlinkSync(fixturePath);
  }
  const scan=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory()){scan(p);continue;}const bytes=readFileSync(p),text=(p.endsWith('.gz')?gunzipSync(bytes):bytes).toString();for(const user of credentials)assert.ok(!text.includes(user.password),`Credential leak in ${p}`);assert.doesNotMatch(text,/"password"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,p);}};
  assert.equal(credentials.length,4);scan(directory);scan(workload);scan(logs);
  writeFileSync(logs+'/verified.json',JSON.stringify({verified:true,backend,mode,code,directory,workload,credentialsScanned:credentials.length,retainedDataUntouched:true},null,2));
  console.log(`Prepared native ${backend} ${mode}: ${logs}`);
});
