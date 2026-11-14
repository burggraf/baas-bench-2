import test from 'node:test';import assert from 'node:assert/strict';
import {cpSync,mkdirSync,mkdtempSync,symlinkSync,readFileSync,writeFileSync,openSync,closeSync,readdirSync,existsSync} from 'node:fs';import {resolve} from 'node:path';import {spawn,execFileSync} from 'node:child_process';
const read=p=>JSON.parse(readFileSync(p)),inputs=['scripts','src','tests','configs','backends','runner','package.json','package-lock.json','compose.yaml','compose.pocketbase.yaml','compose.supabase.yaml','compose.convex.yaml'];
for(const mode of ['success','cancel-preparation'])test(`Convex native API/SDK/ACL/single-backend prepared smoke: ${mode}`,{timeout:600000},async()=>{
 const work=resolve(mkdtempSync('.fixtures/prepared-native-convex-')),out=mkdtempSync('results/convex-native-');
 for(const p of inputs)cpSync(p,`${work}/${p}`,{recursive:true});symlinkSync(resolve('node_modules'),`${work}/node_modules`);mkdirSync(`${work}/.fixtures`,{mode:0o700});mkdirSync(`${work}/results`);
 execFileSync('npm',['run','build'],{cwd:work,stdio:'pipe'});
 const fd=openSync(`${out}/run.log`,'wx'),child=spawn(process.execPath,['scripts/convex.js','--prepared-sessions','--smoke','--optimized-setup','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'],{cwd:work,stdio:['ignore',fd,fd]});closeSync(fd);let signalled=false;
 const timer=mode==='cancel-preparation'?setInterval(()=>{
  for(const d of readdirSync(`${work}/results`).filter(n=>n.startsWith('social-'))){const p=`${work}/results/${d}/prepared-gate.jsonl`;if(!signalled&&existsSync(p)&&readFileSync(p,'utf8').includes('"event":"admitted"')){signalled=true;child.kill('SIGTERM');}}
 },20):null;
 let code;try{code=await new Promise((ok,no)=>{child.once('error',no);child.once('close',ok)});}finally{clearInterval(timer);}
 const name=readdirSync(`${work}/results`).find(n=>/^convex-[A-Za-z0-9]{6}$/.test(n));assert.ok(name,`No controller evidence; inspect ${out}`);const summary=read(`${work}/results/${name}/summary.json`);
 assert.equal(execFileSync('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot'],{encoding:'utf8'}).trim(),'');
assert.equal(existsSync(`${work}/.fixtures/operation.lock`),false);
 const trial=`${work}/results/${name}/point-2`;assert.equal(read(trial+'/shutdown.json').ownedShutdown,true);assert.equal(read(trial+'/conformance.json').logoutRevocation,true);
 if(mode==='success'){
  assert.equal(code,0,`Inspect ${out}`);assert.equal(summary.history[0].verdict,'pass');const r=read(`${work}/${summary.history[0].workloadDirectory}/report.json`);
  const auth=read(trial+'/setup-auth.json');assert.equal(auth.passwordLogins,4);assert.ok(auth.restores>=12);assert.equal(auth.nativeSessionSignouts,4);assert.equal(auth.tokensPersisted,false);
  assert.equal(r.valid,true);assert.equal(r.participation.measuredUsers,2);assert.equal(r.participation.completedUsers,2);assert.equal(r.resources.containers.backend.first.nanoCpus,1000000000);assert.equal(r.runnerBudget.cpus,9);
  for(const a of Object.values(r.actions)){assert.ok(a.count>0);assert.equal(a.failures,0);}
 }else{assert.notEqual(code,0);assert.equal(signalled,true);assert.ok(existsSync(`${work}/.fixtures/convex.json`),'Cancelled fixture retained');}
 writeFileSync(`${out}/verification.json`,JSON.stringify({mode,code,work,controllerSummary:`${work}/results/${name}/summary.json`,ownedShutdown:true},null,2));
});

test('Convex native refresh restores a genuinely expired access token',{timeout:240000},async()=>{
 const work=resolve(mkdtempSync('.fixtures/native-convex-expiry-')),out=mkdtempSync('results/convex-expiry-proof-');
 for(const p of inputs)cpSync(p,`${work}/${p}`,{recursive:true});symlinkSync(resolve('node_modules'),`${work}/node_modules`);mkdirSync(`${work}/.fixtures`,{mode:0o700});mkdirSync(`${work}/results`);
 const auth=`${work}/backends/convex/convex/auth.ts`;writeFileSync(auth,readFileSync(auth,'utf8').replace('accessTokenTtlSeconds:3600','accessTokenTtlSeconds:3'));
 const fd=openSync(`${out}/run.log`,'wx'),child=spawn(process.execPath,['tests/convex-expiry.js'],{cwd:work,stdio:['ignore',fd,fd]});closeSync(fd);
 const code=await new Promise((ok,no)=>{child.once('error',no);child.once('close',ok)});
 assert.equal(execFileSync('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot'],{encoding:'utf8'}).trim(),'');
 writeFileSync(`${out}/result.json`,JSON.stringify({code,work,capacityEligible:false},null,2));assert.equal(code,0,`Inspect ${out}`);
 const name=readdirSync(`${work}/results`).find(n=>n.startsWith('convex-expiry-'));assert.equal(read(`${work}/results/${name}/verification.json`).nativeRefreshAfterExpiry,true);
});
