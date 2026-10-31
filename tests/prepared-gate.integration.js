import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,watch} from 'node:fs';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {assertPreparedCancellation} from './prepared-gate-cancellation.js';

const probe=`import http from 'k6/http'; import exec from 'k6/execution'; import {sleep} from 'k6'; import {Trend} from 'k6/metrics';
const events=new Trend('probe_event'); export const options={scenarios:{probe:{executor:'per-vu-iterations',vus:2,iterations:1,maxDuration:'15s'}},systemTags:['name','status','method']};
export default async function(){ const ordinal=exec.vu.idInTest, local={ordinal};
const control=async(route,values)=>{const r=await http.asyncRequest('POST',__ENV.PREPARED_GATE_ORIGIN+route,JSON.stringify({runId:__ENV.PREPARED_RUN_ID,ordinal,...values}),{headers:{'content-type':'application/json'},timeout:'10s',tags:{name:route,traffic:'control'}});if(r.status!==200)exec.test.abort('probe_control_failed');return r.json();};
await control('/admit',{});if(ordinal===2){if((__ENV.PROBE_MODE==='missing'||__ENV.PROBE_MODE.startsWith('sig'))){sleep(10);return;}sleep(0.3);if(__ENV.PROBE_MODE==='failed'){await control('/failed',{reason:'auth_failed'});return;}}
const release=await control('/ready',{loginAtMs:Date.now(),expiresAtMs:Date.now()+3600000,ttlSeconds:3600});
sleep(Math.max(0,Math.ceil(release.releaseAt-Date.now()))/1000);if(local.ordinal!==ordinal||Date.now()<release.releaseAt)exec.test.abort('probe_state_or_epoch');events.add(ordinal,{event:'business'});}
`;
for(const mode of ['success','missing','failed','child-exit','spawn-failure','sigint','sigterm'])test(`pinned k6 readiness proof: ${mode}`,{timeout:30000},async()=>{
  const directory=mkdtempSync('results/prepared-gate-proof-'),id='social-'+directory.slice(-6),name='prepared-gate-'+directory.slice(-6);
  const config={...JSON.parse(readFileSync('configs/smoke.json')),version:'social-prepared-v1',authPreparation:{loginsPerSecond:5,timeoutSeconds:4}};
  writeFileSync(directory+'/config.json',JSON.stringify(config));writeFileSync(directory+'/probe.js',mode==='child-exit'?"throw new Error('probe_init_failure');\n"+probe:probe);
  const image=execFileSync('docker',['image','inspect','baas-bench-2-pilot-runner','--format','{{.Id}}'],{encoding:'utf8'}).trim();
  const args=['run','--rm','--name',name,'--label','baas-bench-2.prepared-proof='+id,'--network','none','--cpus','4','--memory','16g','--memory-swap','16g','--user',`${process.getuid()}:${process.getgid()}`,
    '-e',`PROBE_MODE=${mode}`,...(mode==='spawn-failure'?['-e','PATH=/no-k6','--entrypoint','/usr/local/bin/node']:[]),'-v',`${resolve(directory)}:/results/${id}`,'-v',`${resolve(directory)}/config.json:/config/run.json:ro`,'-v',`${resolve(directory)}/probe.js:/probe.js:ro`,
    ...['calibration-runner.js','prepared-gate.js','workload.js'].flatMap(file=>['-v',`${resolve('src/'+file)}:/work/${file}:ro`]),image,...(mode==='spawn-failure'?[]:['node']),'/work/calibration-runner.js',id,'--profile=4cpu-16g','--prepared-sessions','run','--summary-export',`/results/${id}/k6-summary.json`,'--out',`json=/results/${id}/metrics.gz`,'/probe.js'];
  let signalled=false;
  const observer=watch(directory,()=>{
    if(!mode.startsWith('sig')||signalled||!existsSync(directory+'/prepared-gate.jsonl'))return;
    const ledger=readFileSync(directory+'/prepared-gate.jsonl','utf8');if(!ledger.includes('"event":"admitted"'))return;
    const state=JSON.parse(execFileSync('docker',['inspect',name,'--format','{{json .}}'],{encoding:'utf8'}));
    assert.equal(state.Image,image);assert.equal(state.Config.Labels['baas-bench-2.prepared-proof'],id);assert.equal(state.Name,'/'+name);
    signalled=true;execFileSync('docker',['kill','--signal',mode.toUpperCase(),state.Id],{stdio:'pipe'});
  });
  const log=[];const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>log.push(b));child.stderr.on('data',b=>log.push(b));
  const timer=setTimeout(()=>child.kill('SIGTERM'),25000);
  let code;try{code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});}finally{clearTimeout(timer);observer.close();writeFileSync(directory+'/native.log',Buffer.concat(log));}
  assert.equal(execFileSync('docker',['ps','-aq','--filter',`name=^/${name}$`],{encoding:'utf8'}).trim(),'','proof container must be gone');
  assert.ok(existsSync(directory+'/prepared-gate.json'),`Prepared supervisor must emit gate evidence; inspect ${directory}`);
  const gate=JSON.parse(readFileSync(directory+'/prepared-gate.json')),rows=readFileSync(directory+'/prepared-gate.jsonl','utf8').trim().split('\n').map(JSON.parse);
  const childExit=JSON.parse(readFileSync(directory+'/runner-child-exit.json'));
  writeFileSync(directory+'/native-child-observation.json',JSON.stringify({mode,code,childExit,signalled}));
  const earlyExit=['child-exit','spawn-failure'].includes(mode);
  let metrics=null,metricsError=null;
  if(!earlyExit)try{const text=gunzipSync(readFileSync(directory+'/metrics.gz')).toString().trim();metrics=text?text.split('\n').map(JSON.parse):[];}
  catch(error){if(!mode.startsWith('sig'))throw error;metricsError=error.code??error.name;assert.ok(['ENOENT','Z_BUF_ERROR','Z_DATA_ERROR','SyntaxError'].includes(metricsError));}
  const business=metrics?.filter(r=>r.type==='Point'&&r.metric==='probe_event');
  const groups=readFileSync(directory+'/runner-cgroups.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.equal(groups.at(-1).final,true);
  if(mode==='success'){
    assert.equal(code,0,`Inspect ${directory}`);assert.equal(gate.status,'released');assert.equal(gate.readyUsers,2);
    assert.deepEqual(business.map(r=>r.data.value).sort(),[1,2]);assert.ok(business.every(r=>Date.parse(r.data.time)>=gate.releaseAt));
    assert.equal(rows.filter(r=>r.event==='ready').length,2);assert.ok(rows.find(r=>r.event==='released').elapsedMs>=rows.filter(r=>r.event==='ready').at(-1).elapsedMs);
  }else if(mode.startsWith('sig')){
    assertPreparedCancellation({mode,signalled,code,childExit,gate,rows,business});
  }else if(earlyExit){
    assert.equal(code,mode==='spawn-failure'?1:107);assert.equal(gate.reason,'child_exit');assert.equal(gate.status,'failed');assert.equal(childExit.spawnFailed,mode==='spawn-failure');assert.equal(existsSync(directory+'/k6-summary.json'),false);
  }else{
    assert.equal(code,108,`Capture the actual pinned native abort exit; inspect ${directory}`);assert.equal(gate.status,'failed');assert.equal(gate.reason,mode==='missing'?'deadline':'auth_failed');assert.equal(business.length,0);
  }
  if(mode!=='spawn-failure'&&!mode.startsWith('sig'))assert.equal(code,childExit.code,'Supervisor preserves the real native child exit');
  writeFileSync(directory+'/verified.json',JSON.stringify({verified:true,mode,code,image,gate,childExit,metricsAvailable:metrics!==null,metricsError,summaryAvailable:existsSync(directory+'/k6-summary.json'),localStatePreserved:mode==='success',noBusinessBeforeRelease:true,finalCounters:true},null,2));
  console.log(`Prepared gate proof ${mode}: ${directory}`);
});
