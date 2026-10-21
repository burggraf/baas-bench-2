import assert from 'node:assert/strict';
import test from 'node:test';
import * as campaign from '../src/campaign.js';
import {baselinePlan,assertBaselineVolume} from '../scripts/baseline.js';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const limits={startVus:1000,minVus:100,maxVus:8000,maxTrials:8,precision:0.1};
const history=entries=>entries.map(([vus,verdict,phase='discovery'])=>({vus,verdict,phase}));
test('campaign starts at 1000, uses a fixed social baseline and refuses unapproved overrides',()=>{
  const p=baselinePlan(['--campaign']);
  assert.equal(p.campaign,true);assert.equal(p.workload,true);assert.equal(p.trials,8);
  assert.deepEqual(p.search,limits);assert.deepEqual(p.config.dataset,{profile:'social-baseline',users:10000,postsPerUser:10,likesPerUser:10});
  assert.deepEqual(p.config,{...baselinePlan(['--workload']).config,dataset:p.config.dataset,vus:1000});
  assert.equal(p.config.vus,1000);assert.deepEqual(p.runnerBudget,{cpus:4,memoryBytes:2147483648});
  assert.deepEqual([p.config.rampSeconds,p.config.warmupSeconds,p.config.measurementSeconds],[30,60,120]);
  const s=baselinePlan(['--campaign','--smoke']);assert.equal(s.config.dataset.users,4);assert.deepEqual(s.search,{...limits,startVus:2,minVus:1,maxVus:4});
  for(const args of [['--campaign','--workload'],['--campaign','--vus=100'],['--campaign','--campaign'],['--campaign','--smoke','--smoke'],['--campaign','--max-vus=9000'],['--campaign','configs/smoke.json']])assert.throws(()=>baselinePlan(args));
});
test('campaign volume extension keeps ordinary three-trial guard and exact ownership',()=>{
  const run='baseline-Abc123',v={Name:`baas-bench-2-pilot_${run}-8`,Driver:'local',Scope:'local',Options:null,Labels:{'baas-bench-2.baseline':run,'baas-bench-2.trial':'8'},CreatedAt:'2026-10-20T00:00:00Z'};
  assert.throws(()=>assertBaselineVolume(v,run,8));assertBaselineVolume(v,run,8,8);
  for(const n of [0,9,1.5])assert.throws(()=>assertBaselineVolume({...v,Name:`baas-bench-2-pilot_${run}-${n}`,Labels:{...v.Labels,'baas-bench-2.trial':String(n)}},run,n,8));
  assert.throws(()=>assertBaselineVolume(v,run,8,100));
});
test('bounded discovery doubles; a failed first 1000 falls back to 100/200/400/800 then refines',()=>{
  assert.equal(typeof campaign.nextCampaignTrial,'function');
  const next=h=>campaign.nextCampaignTrial(history(h),limits);
  assert.deepEqual(next([]),{vus:1000,phase:'discovery'});
  assert.deepEqual(next([[1000,'pass']]),{vus:2000,phase:'discovery'});
  assert.deepEqual(next([[1000,'slo_failure']]),{vus:100,phase:'fallback'});
  assert.deepEqual(next([[1000,'slo_failure'],[100,'pass','fallback']]),{vus:200,phase:'fallback'});
  assert.deepEqual(next([[1000,'slo_failure'],[100,'pass','fallback'],[200,'pass','fallback'],[400,'pass','fallback']]),{vus:800,phase:'fallback'});
  assert.deepEqual(next([[1000,'pass'],[2000,'slo_failure']]),{vus:1500,phase:'refinement'});
  assert.deepEqual(next([[1000,'slo_failure'],[100,'pass','fallback'],[200,'slo_failure','fallback']]),{vus:150,phase:'refinement'});
  assert.equal(next([[1000,'slo_failure'],[100,'slo_failure','fallback']]).stop,'no_passing_candidate');
  assert.equal(next([[1000,'generator_limited']]).stop,'generator_limited');
  assert.equal(next([[1000,'invalid']]).stop,'invalid');
  assert.equal(next([[1000,'pass'],[2000,'pass'],[4000,'pass'],[8000,'pass']]).stop,'search_ceiling_reached');
  assert.equal(next([[1000,'pass'],[1050,'slo_failure','refinement']]).stop,'precision_reached');
  assert.equal(next([[1000,'pass'],[2000,'slo_failure'],[1500,'pass','refinement'],[1750,'slo_failure','refinement'],[1600,'pass','refinement'],[1700,'slo_failure','refinement'],[1625,'pass','refinement'],[1675,'slo_failure','refinement']]).stop,'trial_limit_reached');
  assert.throws(()=>next([[9000,'pass']]));assert.throws(()=>next([[1000,'pass'],[1000,'pass']]));
});
const makeReport=()=>({workloadValid:true,interrupted:null,exitStatus:0,resources:{valid:true},authFailures:0,actions:Object.fromEntries(['listPublic','listOwn','read','create','like','unlike','edit'].map(a=>[a,{requested:50,count:50,failures:0,p95Ms:10,p99Ms:20}]))});
const makeSummary=()=>({metrics:{auth_failed:{value:0},auth_http_failed:{value:0},'logical_failed{phase:measurement}':{value:0},http_req_failed:{value:0}}});
test('discovery classifies numerical observations without certifying insufficient tails; failures stay distinct from invalid evidence',()=>{
  assert.equal(typeof campaign.classifyCampaignTrial,'function');
  const classify=(r=makeReport(),m=makeSummary(),pressure=false)=>campaign.classifyCampaignTrial(r,m,pressure);
  assert.equal(classify().verdict,'pass');assert.equal(classify().certified,false);
  const r=makeReport();r.exitStatus=99;r.actions.read.p95Ms=501;assert.equal(classify(r).verdict,'slo_failure');
  for(const a of [{p99Ms:2001},{failures:1},{p95Ms:null},{count:0},{requested:51}]){const r=makeReport();Object.assign(r.actions.read,a);assert.equal(classify(r).verdict,['p95Ms','count','requested'].some(k=>Object.hasOwn(a,k))?'invalid':'slo_failure');}
  for(const change of [{workloadValid:false},{resources:{valid:false}},{exitStatus:137},{interrupted:'SIGTERM'}])assert.equal(classify({...makeReport(),...change}).verdict,'invalid');
  assert.equal(classify(makeReport(),{metrics:{}}).verdict,'invalid');
  assert.equal(classify(makeReport(),makeSummary(),true).verdict,'generator_limited');
  const m=makeSummary();m.metrics.auth_failed.value=0.1;assert.equal(classify(makeReport(),m).verdict,'slo_failure');
});
test('live guard stops before memory cap, on OOM/health loss or collector errors, not on harmless startup CPU peaks',()=>{
  assert.equal(typeof campaign.campaignResourceStop,'function');
  const group=n=>`[memory.current]\n${n}\n[memory.events]\nmax 0\noom 0\noom_kill 0\n[cpu.stat]\nusage_usec 1\n`;
  assert.equal(campaign.campaignResourceStop({type:'cgroup',role:'runner',source:group(100000000)}),null);
  assert.equal(campaign.campaignResourceStop({type:'cgroup',role:'runner',source:group(1900000000)}),'runner_memory_guard');
  assert.equal(campaign.campaignResourceStop({type:'cgroup',role:'backend',source:group(4000000000)}),'backend_memory_guard');
  assert.equal(campaign.campaignResourceStop({type:'error',role:'runner'}),'invalid_telemetry');
  assert.equal(campaign.campaignResourceStop({type:'cgroup',role:'runner',source:group(1).replace('oom 0','oom 1')}),'runner_memory_events');
  assert.equal(campaign.campaignResourceStop({type:'lifecycle',role:'backend',source:{running:true,health:'unhealthy',oomKilled:false}}),'backend_health');
  assert.equal(campaign.campaignResourceStop({type:'stats',role:'runner',source:{CPUPerc:'400%'}}),null);
});
test('original gzip measurement points align CPU checks, without loading or rewriting the full metric stream',async()=>{
  assert.equal(typeof campaign.measurementStart,'function');
  const file=join(mkdtempSync(join(tmpdir(),'campaign-metrics-')),'metrics.gz');
  const row=(phase,time)=>JSON.stringify({type:'Point',metric:'action_requested',data:{tags:{phase},time}});
  writeFileSync(file,gzipSync(row('warmup','2026-10-20T00:00:00Z')+'\n'+row('measurement','2026-10-20T00:01:30Z')+'\n'));
  assert.equal(await campaign.measurementStart(file),Date.parse('2026-10-20T00:01:30Z'));
  writeFileSync(file,gzipSync(row('warmup','2026-10-20T00:00:00Z')+'\n'));await assert.rejects(campaign.measurementStart(file));
});
test('measured sustained CPU pressure is generator-limited; initialization is excluded',()=>{
  assert.equal(typeof campaign.campaignCpuPressure,'function');
  const start=Date.parse('2026-10-20T00:00:00Z');
  const rows=Array.from({length:12},(_,i)=>({at:new Date(start+i*1000).toISOString(),elapsedMs:i*1000,source:`[cpu.stat]\nusage_usec ${i*4000000}\n`}));
  assert.equal(campaign.campaignCpuPressure(rows,start,10),true);
  assert.equal(campaign.campaignCpuPressure(rows,start+60000,10),false);
  assert.equal(campaign.campaignCpuPressure(rows.map((r,i)=>({...r,source:`[cpu.stat]\nusage_usec ${i*1000000}\n`})),start,10),false);
});
