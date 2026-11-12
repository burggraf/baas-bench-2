import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {baselinePlan} from '../scripts/baseline.js';
import {payloadCachePlan,validatePayloadTable,createPayloadLookup} from '../src/payload-cache.js';
import {writePayloadCache} from '../scripts/payload-cache.js';
import {postFields} from '../src/workload.js';
const args=['--prepared-sessions','--vus=15000','--runner-cpus=8','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];
const oldArgs=args.map(a=>a==='--vus=15000'?'--vus=10000':a==='--payload-cache=480m'?'--payload-cache=320m':a);
const MiB=1024*1024;

test('15000 distinct users scale the dataset and preparation deadline with the existing workload and resource policy',()=>{
  const prior=baselinePlan(oldArgs),next=baselinePlan(args);
  assert.deepEqual(next.config,{...prior.config,vus:15000,dataset:{...prior.config.dataset,profile:'social-baseline-15000',users:15000},authPreparation:{...prior.config.authPreparation,timeoutSeconds:3200}});
  assert.equal(next.configPath,'configs/prepared-social-15000.json');assert.deepEqual(next.runnerBudget,prior.runnerBudget);assert.equal(next.runnerGc,prior.runnerGc);assert.equal(next.runnerProfile,prior.runnerProfile);assert.equal(next.hostSafety,true);assert.equal(next.trials,1);assert.equal(next.payloadCacheBytes,480*MiB);
  assert.deepEqual(baselinePlan(args.slice().reverse()),next);
  assert.equal(next.config.dataset.users*next.config.dataset.postsPerUser,150000);assert.equal(next.config.dataset.users*next.config.dataset.likesPerUser,150000);
});

test('15000 is bounded to the explicit single-worker allocation and matching cache; other profiles stay unchanged',()=>{
  for(const flag of args)assert.throws(()=>baselinePlan(args.filter(a=>a!==flag)));
  for(const extra of ['--runner-workers=2','--diagnostic-profile','--payload-cache=480m','--payload-cache=320m','--vus=15000','--runner-memory=48g'])assert.throws(()=>baselinePlan([...args,extra]));
  for(const vus of [10500,14500,15001,20000])assert.throws(()=>baselinePlan(args.map(a=>a==='--vus=15000'?`--vus=${vus}`:a)));
  assert.throws(()=>baselinePlan(oldArgs.map(a=>a==='--payload-cache=320m'?'--payload-cache=480m':a)));
  assert.throws(()=>baselinePlan(args.map(a=>a==='--payload-cache=480m'?'--payload-cache=320m':a)));
  const smoke=baselinePlan(args.map(a=>a==='--vus=15000'?'--smoke':a));assert.deepEqual(smoke.config,JSON.parse(readFileSync('configs/prepared-smoke.json')));assert.equal(smoke.payloadCacheBytes,480*MiB);
  assert.equal(baselinePlan(oldArgs).payloadCacheBytes,320*MiB);assert.equal(baselinePlan(oldArgs.filter(a=>!a.startsWith('--payload-cache='))).payloadCacheBytes,undefined);
});

test('480MiB preserves 32 cache slots per user through the last 15000-user identity and exact fallback',()=>{
  const plan=baselinePlan(args),c=plan.config,p=payloadCachePlan(c,480*MiB),old=payloadCachePlan(baselinePlan(oldArgs).config,320*MiB);
  assert.equal(p.slotsPerUser,old.slotsPerUser);assert.equal(p.slotsPerUser,32);assert.equal(p.records,480000);assert.ok(p.records*c.bodyBytes<=480*MiB);assert.equal(p.firstSequence,old.firstSequence);assert.equal(p.version,old.version);
  const rows=new Array(p.records);for(const user of [0,9999,10000,14999])for(const slot of [0,31])rows[user*32+slot]=postFields(c,user,p.firstSequence+slot);
  const lookup=createPayloadLookup(c,rows,480*MiB);
  for(const user of [0,9999,10000,14999])for(const sequence of [1,11,42,43,10001])assert.deepEqual(lookup(user,sequence),postFields(c,user,sequence));
  assert.equal(payloadCachePlan(c).version,'deterministic-post-cache-v1');
});

test('480MiB cache files bind their budget/hash and keep native-smoke payloads byte equivalent',async t=>{
  const root=mkdtempSync(tmpdir()+'/payload-480m-');t.after(()=>rmSync(root,{recursive:true}));const path=root+'/cache.json';
  const c=baselinePlan(args.map(a=>a==='--vus=15000'?'--smoke':a)).config,budget=480*MiB;
  const result=await writePayloadCache(path,c,undefined,budget),bytes=readFileSync(path),table=JSON.parse(bytes);
  assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.bytes,bytes.length);assert.equal(result.recipe.budgetBytes,budget);
  const lookup=createPayloadLookup(c,validatePayloadTable(table,c,budget),budget);
  for(let user=0;user<c.vus;user++)for(let sequence=1;sequence<=45;sequence++)assert.deepEqual(lookup(user,sequence),postFields(c,user,sequence));
  for(const other of [undefined,320*MiB])assert.throws(()=>validatePayloadTable(table,c,other),/invalid_payload_cache/);
  table.recipe.budgetBytes=320*MiB;assert.throws(()=>validatePayloadTable(table,c,budget),/invalid_payload_cache/);
});
