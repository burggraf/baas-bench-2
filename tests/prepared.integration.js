import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,unlinkSync,watch} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {hash,capture} from '../scripts/runtime.js';
import {savePrivate} from '../src/fixtures.js';

const read=p=>JSON.parse(readFileSync(p));
for(const backend of ['trailbase','pocketbase'])for(const mode of ['success','failed-login','cancel-preparation','cancel-measurement'])test(`prepared ${backend} ${mode}`,{timeout:180000},async()=>{
  assert.match(process.cwd(),/\/\.fixtures\/prepared-(native|regression)-[A-Za-z0-9-]+$/,'Run native tests only in a fresh isolated validation workspace');
  const controller=backend==='trailbase'?'baseline':'pocketbase',fixturePath=`.fixtures/${backend}.json`;
  assert.equal(existsSync(fixturePath),false);
  const source=readFileSync('src/k6/social.js','utf8'),needle='await client.login(user.username, user.password);';
  if(mode==='failed-login'){
    assert.equal(source.split(needle).length,2,'Fault injection must modify exactly one SDK login site');
    writeFileSync('src/k6/social.js',source.replace(needle,"await client.login(user.username, currentPhase === 'preparation' && exec.vu.idInTest === 2 ? user.password + 'incorrect' : user.password);"));
  }
  execFileSync('npm',['run','build'],{stdio:'pipe'});
  const logs=mkdtempSync('results/prepared-native-');
  if(mode==='failed-login')writeFileSync(logs+'/fault.json',JSON.stringify({kind:'test-only wrong password for prepared VU2',sourceHash:hash('src/k6/social.js')}));
  const child=spawn(process.execPath,[`scripts/${controller}.js`,'--prepared-sessions','--smoke'],{stdio:['ignore','pipe','pipe']});
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
  finally{clearTimeout(timeout);clearTimeout(signalTimer);fixtureWatch.close();resultWatch.close();if(mode==='failed-login'){writeFileSync('src/k6/social.js',source);execFileSync('npm',['run','build'],{stdio:'pipe'});}}
  assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(capture('docker',['network','ls','-q','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(existsSync('.fixtures/operation.lock'),false);
  const directory=stdout.match(/(?:Baseline proof failed \([^\n]*?; inspect |Fresh workload proof: |PocketBase evidence: )(results\/(?:baseline|pocketbase)-[A-Za-z0-9]{6})/)?.[1];
  assert.ok(directory,`Missing controller pointer; inspect ${logs}`);
  if(!workload){const pointer=controller==='baseline'?read(directory+'/trial-1.json').workload:read(directory+'/point-2/workload.json');workload=pointer.directory;}
  assert.ok(workload);
  if(mode==='success'){
    assert.equal(code,0,`Inspect ${logs}`);const r=read(workload+'/report.json');
    assert.equal(r.kind,'prepared-session-fixed-vu-exploratory');assert.equal(r.valid,true);assert.equal(r.preparedEvidenceValid,true);
    assert.equal(r.preparation.readyUsers,2);assert.equal(r.preparation.loginAttempts,2);assert.equal(r.preparation.protectedReadSuccesses,2);
    assert.equal(r.authenticationEvidence.phases.ramp.login.attempts,0);assert.equal(r.authenticationEvidence.phases.warmup.login.attempts,0,'Active session age starts at activation, not preparation login');
    assert.equal(r.preparation.ttlSeconds===null,backend==='pocketbase');assert.equal(r.preparation.nativeTtlKnownUsers,backend==='pocketbase'?0:2);
    assert.equal(r.participation.measuredUsers,2);assert.equal(r.participation.completedUsers,2);
    assert.equal(r.phaseTiming.endAt-r.phaseTiming.measurementAt,12000);assert.equal(r.authFailures,0);
    assert.equal(r.traffic.controlRequests,4);assert.equal(r.traffic.controlFailureRate,0);
    for(const a of Object.values(r.actions)){assert.ok(a.count>0);assert.equal(a.failures,0);}
    assert.equal(r.resources.containers.backend.first.nanoCpus,1e9);assert.equal(r.resources.containers.runner.first.memoryLimit,17179869184);
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
