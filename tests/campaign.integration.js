import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {closeSync,existsSync,mkdtempSync,openSync,readFileSync,readdirSync,unlinkSync,watch} from 'node:fs';
import {delimiter,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {assertBaselineVolume,assertBaselineBackend} from '../scripts/baseline.js';
import {controllerClient} from '../scripts/client.js';
import {capture,hash} from '../scripts/runtime.js';
import {deleteFixture,savePrivate} from '../src/fixtures.js';
import {summarizeResources} from '../src/resources.js';
import {assertHostMemoryCoverage,vmMemoryStop} from '../src/campaign.js';

const execute=promisify(execFile),fixturePath='.fixtures/trailbase.json';
const read=path=>JSON.parse(readFileSync(path));
const cleanResources=()=>{
  assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(capture('docker',['network','ls','-q','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(existsSync('.fixtures/operation.lock'),false);
};
for(const memoryBytes of [2147483648,4294967296]) {
const extra=memoryBytes===4294967296?['--runner-memory=4g']:[],suffix=extra.length?' (4-GiB/host-guarded)':'';
test('bounded campaign smoke makes distinct fresh 2/4-user trials, applies live guards and retains original private-free evidence'+suffix,{timeout:180000,skip:extra.length>0&&process.platform!=='darwin'},async()=>{
  assert.equal(existsSync(fixturePath),false);
  const passwords=new Set();
  const watcher=watch('.fixtures',()=>{try{const f=read(fixturePath);if(f.status==='used')for(const u of f.users)passwords.add(u.password);}catch{}});
  let result;
  try{result=await execute(process.execPath,['scripts/baseline.js','--campaign','--smoke',...extra],{timeout:160000,maxBuffer:16*1024*1024});}finally{watcher.close();}
  const root=result.stdout.match(/Campaign proof: (results\/baseline-[A-Za-z0-9]{6})/)?.[1];assert.ok(root);
  const report=read(`${root}/report.json`);assert.equal(report.kind,'bounded-local-discovery');assert.equal(report.valid,true);assert.equal(report.certified,false);
  assert.equal(report.search.stop,'search_ceiling_reached');assert.equal(report.search.lowerVus,4);assert.equal(report.search.upperVus,null);
  assert.deepEqual(report.pilotVolumeBefore,report.pilotVolumeAfter);assert.equal(report.trials.length,2);assert.equal(passwords.size,8);
  assert.equal(new Set(report.trials.map(t=>t.identityHash)).size,2);assert.equal(new Set(report.trials.map(t=>t.baseline.logicalHash)).size,1);
  const dirs=[root];
  for(const[i,t]of report.trials.entries()){
    const d=t.workload.directory;dirs.push(d);
    assert.equal(t.candidate.vus,[2,4][i]);assert.equal(read(`${d}/config.json`).vus,t.candidate.vus);
    assert.equal(t.classification.verdict,'pass');assert.equal(t.classification.certified,false);assert.equal(t.generatorCheck.sustainedCpuPressure,false);
    assert.equal(t.workload.report.sloEvidence,'insufficient_samples');assert.equal(t.workload.report.certified,false);assert.equal(t.apiReset.posts,0);
    assert.equal(t.workload.report.resources.generatorHeadroom,'unverified');
    const guard=read(`${d}/campaign-guard.json`);assert.ok(guard.observations>10);assert.equal(guard.stop,null);assert.equal(guard.memoryStopFraction,.85);
    const rows=readFileSync(`${d}/resources.jsonl`,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(summarizeResources(rows),t.workload.report.resources);
    assert.deepEqual(readFileSync(`${d}/runner-limits.txt`,'utf8').trim().split(/\s+/).map(Number),[400000,100000,memoryBytes,0]);
    assert.deepEqual(t.workload.report.runnerBudget,{cpus:4,memoryBytes});
    if(extra.length){assert.equal(guard.hostMemoryGuard,true);assertHostMemoryCoverage(rows);assert.ok(rows.filter(r=>r.type==='cgroup'&&r.role==='runner').every(r=>vmMemoryStop(r.source)===null));}
    for(const[p,h]of Object.entries(read(`${d}/manifest.json`).hashes))assert.equal(hash(p),h,p);
    const volume=JSON.parse(capture('docker',['volume','inspect',t.volume.Name]))[0];assertBaselineVolume(volume,root.split('/').at(-1),i+1,8);assert.deepEqual(volume,t.volume);
  }
  const scan=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory()){scan(p);continue;}const raw=readFileSync(p),s=(e.name.endsWith('.gz')?gunzipSync(raw):raw).toString();for(const password of passwords)assert.ok(!s.includes(password),p);assert.doesNotMatch(s,/auth_token|refresh_token|"password"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,p);}};
  for(const d of dirs)scan(d);assert.equal(existsSync(fixturePath),false);cleanResources();
});

test('campaign SIGTERM stops all later trials, preserves the used private fixture and requires explicit exact-volume SDK cleanup'+suffix,{timeout:120000,skip:extra.length>0&&process.platform!=='darwin'},async()=>{
  assert.equal(existsSync(fixturePath),false);
  const logs=mkdtempSync('results/campaign-interruption-'),out=openSync(`${logs}/stdout.log`,'w'),err=openSync(`${logs}/stderr.log`,'w');
  const child=spawn(process.execPath,['scripts/baseline.js','--campaign','--smoke',...extra],{stdio:['ignore',out,err]});
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  let op;
  try{
    const deadline=Date.now()+45000;
    while(true){
      assert.ok(Date.now()<deadline);assert.equal(child.exitCode,null);
      try{op=read('.fixtures/operation.lock');const rows=readFileSync(`${op.workloadDirectory}/resources.jsonl`,'utf8').trim().split('\n').map(JSON.parse),first=rows.find(r=>r.type==='lifecycle'&&r.role==='runner'&&r.source.running);if(first&&rows.at(-1).elapsedMs-first.elapsedMs>=6000)break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    child.kill('SIGTERM');assert.equal((await ended).code,143);cleanResources();
    const root=`results/${op.baselineRunId}`,report=read(`${root}/report.json`),fixture=read(fixturePath),trial=read(`${root}/trial-1.json`);
    assert.equal(report.valid,false);assert.equal(report.trials.length,0);assert.equal(report.activeTrial.number,1);assert.equal(report.activeTrial.workloadDirectory,op.workloadDirectory);assert.equal(trial.workload.directory,op.workloadDirectory);assert.equal(existsSync(`${root}/trial-2.compose.json`),false);assert.equal(fixture.status,'used');
    assert.equal(read(`${root}/failure.json`).interrupted,'SIGTERM');
    const volume=JSON.parse(capture('docker',['volume','inspect',fixture.volume]))[0];assertBaselineVolume(volume,op.baselineRunId,1,8);assert.deepEqual(volume,trial.volume);
    const env={...process.env,COMPOSE_FILE:[resolve('compose.yaml'),resolve(`${root}/trial-1.compose.json`)].join(delimiter),COMPOSE_PROJECT_NAME:'baas-bench-2-pilot',COMPOSE_PATH_SEPARATOR:delimiter};
    const compose=async args=>(await execute('docker',['compose',...args],{env,timeout:30000})).stdout.trim();let backendId;
    const check=()=>{const[s]=JSON.parse(capture('docker',['inspect',backendId]));assertBaselineBackend({id:s.Id,project:s.Config.Labels['com.docker.compose.project'],service:s.Config.Labels['com.docker.compose.service'],mounts:s.Mounts},backendId,fixture.volume);assert.equal(s.Image,trial.runtime.backend.imageId);};
    try{
      await compose(['up','-d','--wait','trailbase']);backendId=await compose(['ps','-q','trailbase']);check();
      const signal=new AbortController().signal;await deleteFixture(fixture,()=>controllerClient(signal),v=>savePrivate(fixturePath,v));
      assert.equal((await controllerClient(signal).records('posts').list({pagination:{limit:1},count:true})).total_count,0);unlinkSync(fixturePath);
    }finally{if(backendId){check();await compose(['down']);}}
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await ended;}closeSync(out);closeSync(err);}
});
}
