import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {closeSync,existsSync,mkdtempSync,openSync,readFileSync,readdirSync,statSync,unlinkSync,watch} from 'node:fs';
import {delimiter,resolve} from 'node:path';
import {assertBaselineVolume,assertBaselineBackend} from '../scripts/baseline.js';
import {deleteFixture,savePrivate} from '../src/fixtures.js';
import {controllerClient} from '../scripts/client.js';
import {gunzipSync} from 'node:zlib';
import {capture,hash} from '../scripts/runtime.js';
import {summarizeResources} from '../src/resources.js';
import {assertHostMemoryCoverage,vmMemoryStop} from '../src/campaign.js';

const execute=promisify(execFile);
for(const memoryBytes of [2147483648,4294967296]) {
const extra=memoryBytes===4294967296?['--runner-memory=4g']:[],suffix=extra.length?' (4-GiB/host-guarded)':'';
test('fresh full-workload smoke enforces the approved runner budget, API-cleans only its new deployment and retains auditable private-free evidence'+suffix, {timeout:180000,skip:extra.length>0&&process.platform!=='darwin'}, async()=>{
  assert.equal(existsSync('.fixtures/trailbase.json'),false);
  let credentials=[],savedFixture;
  const watcher=watch('.fixtures',()=>{try {const f=JSON.parse(readFileSync('.fixtures/trailbase.json'));if(f.users?.length)credentials=f.users;if(f.status==='used')savedFixture=f;}catch{}});
  let result;
  try {result=await execute(process.execPath,['scripts/baseline.js','--workload','--smoke',...extra],{timeout:160000,maxBuffer:16*1024*1024});}
  finally {watcher.close();}
  const directory=result.stdout.match(/Fresh workload proof: (results\/baseline-[A-Za-z0-9]{6})/)?.[1];
  assert.ok(directory,'new bounded mode must record its fresh deployment and timed workload');
  const report=JSON.parse(readFileSync(`${directory}/report.json`));
  assert.equal(report.kind,'fresh-deployment-workload-sizing');assert.equal(report.valid,true);assert.equal(report.certified,false);
  assert.equal(report.trials.length,1);assert.deepEqual(report.pilotVolumeBefore,report.pilotVolumeAfter);
  const trial=report.trials[0],{directory:run,report:workload}=trial.workload;
  assert.equal(trial.apiReset.posts,0);assert.equal(trial.volumeRetained,true);
  assert.equal(workload.valid,true);assert.equal(workload.certified,false);assert.equal(workload.resources.generatorHeadroom,'unverified');
  assert.deepEqual(workload.runnerBudget,{cpus:4,memoryBytes});
  assert.equal(workload.start.users,4);assert.equal(workload.start.posts,40);assert.equal(workload.start.likes,40);
  for(const action of Object.values(workload.actions)){assert.ok(action.count>0);assert.equal(action.failures,0);}
  assert.ok(workload.loginCount>=4);
  for(const boundary of ['first','last']){const policy=workload.resources.containers.runner[boundary];assert.equal(policy.nanoCpus,4e9);assert.equal(policy.memoryLimit,memoryBytes);assert.equal(policy.memorySwap,memoryBytes);}
  assert.deepEqual(readFileSync(`${run}/runner-limits.txt`,'utf8').trim().split(/\s+/).map(Number),[400000,100000,memoryBytes,0]);
  const originals=readFileSync(`${run}/runner-cgroups.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(originals.at(-1).final,true);
  const rows=readFileSync(`${run}/resources.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(summarizeResources(rows),workload.resources);
  for(const row of rows.filter(r=>r.type==='cgroup'&&r.role==='backend')){
    assert.deepEqual(row.capture.argv.slice(0,4),['exec',workload.resources.containers.backend.first.id,'sh','-c']);
    assert.equal(row.capture.clientExitCode,0);assert.equal(row.capture.stdoutBytes,Buffer.byteLength(row.source));assert.equal(typeof row.capture.stderr,'string');
    assert.ok(Number.isFinite(Date.parse(row.capture.startedAt)));assert.ok(row.capture.durationMs>=0);
  }
  assert.deepEqual(rows.filter(r=>r.type==='cgroup'&&r.role==='runner').map(r=>r.source),originals.map(r=>r.source));
  if(extra.length){
    assertHostMemoryCoverage(rows);
    assert.ok(originals.every(r=>r.source.includes('[vm.meminfo]')&&vmMemoryStop(r.source)===null));
    assert.equal(JSON.parse(readFileSync(`${run}/campaign-guard.json`)).hostMemoryGuard,true);
    const before=JSON.parse(readFileSync(`${run}/host-before-run.json`));assert.equal(vmMemoryStop(before.vm.stdout,true),null);assert.equal(before.host.stdout.trim(),'1');
    assert.equal(JSON.parse(readFileSync(`${run}/manifest.json`)).runnerProfile,'4cpu-4g');
  }
  for(const[path,digest]of Object.entries(JSON.parse(readFileSync(`${run}/manifest.json`)).hashes))assert.equal(hash(path),digest,path);
  assert.equal(credentials.length,4,'capture this run’s real passwords in test memory before SDK deletion');
  assert.equal(savedFixture?.volume,trial.volume.Name,'consuming a fresh fixture must retain its deployment identity');
  assert.deepEqual(savedFixture?.preparation,trial.runtime,'consuming a fresh fixture must retain preparation provenance');
  const scan=dir=>{for(const f of readdirSync(dir,{withFileTypes:true})){const path=`${dir}/${f.name}`;if(f.isDirectory()){scan(path);continue;}const b=readFileSync(path),text=(f.name.endsWith('.gz')?gunzipSync(b):b).toString();for(const user of credentials)assert.ok(!text.includes(user.password),path);assert.doesNotMatch(text,/auth_token|refresh_token|"password"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,path);}};
  scan(directory);scan(run);
  assert.equal(statSync(`${directory}/workload-config.json`).isFile(),true);
  assert.equal(existsSync('.fixtures/trailbase.json'),false);assert.equal(existsSync('.fixtures/operation.lock'),false);
  assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(capture('docker',['network','ls','-q','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
  assert.equal(JSON.parse(capture('docker',['volume','inspect',trial.volume.Name]))[0].CreatedAt,trial.volume.CreatedAt);
});

test('SIGTERM preserves the used fresh fixture, removes owned resources, and ordinary pilot commands still refuse its volume'+suffix, {timeout:120000,skip:extra.length>0&&process.platform!=='darwin'}, async()=>{
  assert.equal(existsSync('.fixtures/trailbase.json'),false);
  const logs=mkdtempSync('results/fresh-interruption-'),out=openSync(`${logs}/stdout.log`,'w'),err=openSync(`${logs}/stderr.log`,'w');
  const child=spawn(process.execPath,['scripts/baseline.js','--workload','--smoke',...extra],{stdio:['ignore',out,err]});
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  let operation;
  try {
    const deadline=Date.now()+45000;
    while(true){
      assert.ok(Date.now()<deadline,'fresh workload must reach active measurement');
      assert.equal(child.exitCode,null,'controller must not fail before interruption');
      try {
        operation=JSON.parse(readFileSync('.fixtures/operation.lock'));
        const rows=readFileSync(`${operation.workloadDirectory}/resources.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
        const first=rows.find(r=>r.type==='lifecycle'&&r.role==='runner'&&r.source.running);
        if(first&&rows.at(-1).elapsedMs-first.elapsedMs>=6000&&rows.filter(r=>r.type==='stats'&&r.role==='runner').length>=2)break;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    child.kill('SIGTERM');assert.equal((await ended).code,143);
    assert.equal(existsSync('.fixtures/operation.lock'),false);
    assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
    const path='.fixtures/trailbase.json',original=readFileSync(path,'utf8'),fixture=JSON.parse(original);
    assert.equal(fixture.status,'used');assert.equal(fixture.volume,operation.trialVolume);assert.equal(statSync(path).mode&0o777,0o600);
    const root=`results/${operation.baselineRunId}`,evidence=JSON.parse(readFileSync(`${root}/trial-1.json`));
    assert.equal(JSON.parse(readFileSync(`${root}/failure.json`)).interrupted,'SIGTERM');
    if(existsSync(`${operation.workloadDirectory}/report.json`))assert.equal(JSON.parse(readFileSync(`${operation.workloadDirectory}/report.json`)).valid,false);
    assert.equal(capture('docker',['network','ls','-q','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
    // This test alone reopens its exact retained deployment for explicit SDK cleanup, never a performance baseline.
    const volume=JSON.parse(capture('docker',['volume','inspect',fixture.volume]))[0];
    assertBaselineVolume(volume,operation.baselineRunId,1);assert.equal(volume.CreatedAt,evidence.volume.CreatedAt);
    const env={...process.env,COMPOSE_FILE:[resolve('compose.yaml'),resolve(`${root}/trial-1.compose.json`)].join(delimiter),COMPOSE_PROJECT_NAME:'baas-bench-2-pilot',COMPOSE_PATH_SEPARATOR:delimiter};
    const compose=async args=>(await execute('docker',['compose',...args],{env,timeout:30000})).stdout.trim();
    let backendId;
    const check=()=>{const [state]=JSON.parse(capture('docker',['inspect',backendId]));assertBaselineBackend({id:state.Id,project:state.Config.Labels['com.docker.compose.project'],service:state.Config.Labels['com.docker.compose.service'],mounts:state.Mounts},backendId,fixture.volume);assert.equal(state.Image,evidence.runtime.backend.imageId);};
    try {
      await compose(['up','-d','--wait','trailbase']);backendId=await compose(['ps','-q','trailbase']);check();
      for(const action of ['prepare','run','reset']){
        await assert.rejects(execute(process.execPath,['scripts/social.js',action,'configs/smoke.json'],{env,timeout:30000}),error=>error.code===1&&error.stderr.includes('Refuse non-pilot deployment'));
        assert.equal(readFileSync(path,'utf8'),original,'ordinary commands cannot adopt/delete the fresh fixture');
      }
      const cleanupSignal=new AbortController().signal;
      await deleteFixture(fixture,()=>controllerClient(cleanupSignal),value=>savePrivate(path,value));
      assert.equal((await controllerClient(cleanupSignal).records('posts').list({pagination:{limit:1},count:true})).total_count,0);
      unlinkSync(path);
    } finally {if(backendId){check();await compose(['down']);}}
  } finally {
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await ended;}
    closeSync(out);closeSync(err);
  }
});
}
