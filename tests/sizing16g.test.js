import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {runnerBudget} from '../src/calibration-runner.js';
import * as safety from '../src/campaign.js';
const {campaignResourceStop,vmMemoryStop,assertHostMemoryCoverage,prestartMemoryReserve}=safety;

const GiB=1073741824,limit=16*GiB;
const vm=(available=24*GiB,swapFree=GiB)=>`MemTotal: ${32*GiB/1024} kB\nMemAvailable: ${available/1024} kB\nSwapTotal: ${GiB/1024} kB\nSwapFree: ${swapFree/1024} kB\n`;
const host=source=>({type:'host_memory',role:'host',source:{platform:'linux',stdout:source,stderr:'',exitCode:0}});
const group=(bytes,source=vm())=>`[cpu.stat]\nusage_usec 1\n[memory.current]\n${bytes}\n[memory.events]\nmax 0\noom 0\noom_kill 0\n[vm.meminfo]\n${source}`;

test('16-GiB profile requires explicit single 2000-user campaign or tiny correctness smoke',()=>{
  const args=['--campaign','--vus=2000','--runner-memory=16g'];
  const p=baselinePlan(args),old=baselinePlan(args.map(a=>a.replace('16g','4g')));
  assert.deepEqual(p,{...old,runnerBudget:{cpus:4,memoryBytes:limit},runnerProfile:'4cpu-16g'});
  assert.equal(p.trials,1);assert.equal(p.search.maxTrials,1);
  for(const mode of ['--campaign','--workload']){
    const s=baselinePlan([mode,'--smoke','--runner-memory=16g']);
    assert.equal(s.runnerProfile,'4cpu-16g');assert.equal(s.hostSafety,true);assert.equal(s.config.dataset.users,4);assert.equal(s.runnerBudget.memoryBytes,limit);
  }
  for(const args of [['--campaign','--runner-memory=16g'],['--campaign','--vus=1000','--runner-memory=16g'],['--campaign','--vus=4000','--runner-memory=16g'],['--campaign','--vus=2000','--runner-memory=16g','--runner-memory=4g'],['--campaign','--vus=2000','--runner-memory=16g','--runner-memory=16g'],['--workload','--vus=1000','--runner-memory=16g'],['--campaign','--smoke','--vus=2000','--runner-memory=16g']])assert.throws(()=>baselinePlan(args));
});
test('approved1500 followup is one fresh16GiB candidate with unchanged recipe, budgets and optional backend95 policy',()=>{
  const args=['--campaign','--vus=1500','--runner-memory=16g'],p=baselinePlan(args),previous=baselinePlan(args.map(a=>a==='--vus=1500'?'--vus=2000':a));
  assert.equal(p.config.vus,1500);assert.deepEqual(p.config,{...previous.config,vus:1500});
  assert.equal(p.trials,1);assert.equal(p.search.maxTrials,1);assert.equal(p.search.startVus,1500);
  assert.deepEqual(p.runnerBudget,{cpus:4,memoryBytes:limit});assert.equal(p.runnerProfile,'4cpu-16g');assert.equal(p.hostSafety,true);
  assert.deepEqual(baselinePlan([...args,'--backend-memory-stop=95']),{...p,backendMemoryStopFraction:.95});
  for(const vus of [1000,1499,1501,3000])assert.throws(()=>baselinePlan(args.map(a=>a==='--vus=1500'?`--vus=${vus}`:a)));
  assert.throws(()=>baselinePlan([...args,'--vus=2000']));
});
test('16-GiB supervisor retains explicit identity/budget validation and unchanged defaults',()=>{
  assert.deepEqual(runnerBudget('social-Abc123','4cpu-16g'),{cpus:4,memoryBytes:limit});
  assert.deepEqual(runnerBudget('social-Abc123'),{cpus:4,memoryBytes:2*GiB});
  assert.deepEqual(runnerBudget('social-Abc123','4cpu-4g'),{cpus:4,memoryBytes:4*GiB});
  for(const [id,p]of [['calibration-Abc123-400','4cpu-16g'],['social-Abc123','4cpu-32g'],['social-Abc123','8cpu-16g']])assert.throws(()=>runnerBudget(id,p));
});
test('16-GiB prestart reserve accounts for runner guard, full backend budget and live host reserve',()=>{
  assert.equal(typeof prestartMemoryReserve,'function');
  assert.equal(prestartMemoryReserve(4*GiB),4*GiB*.85+GiB);
  assert.equal(prestartMemoryReserve(limit),limit*.85+4*GiB+GiB);
  assert.equal(vmMemoryStop(vm(18*GiB),true,limit),'vm_memory_reserve');
  assert.equal(vmMemoryStop(vm(19*GiB),true,limit),null);
  assert.equal(vmMemoryStop(vm(5*GiB),true,4*GiB),null);
  assert.equal(vmMemoryStop(vm(GiB/2),false,limit),'vm_memory_reserve');
  assert.equal(vmMemoryStop(vm(24*GiB,0),true,limit),'vm_swap_pressure');
  assert.throws(()=>prestartMemoryReserve(8*GiB));
});
test('16-GiB guard still rejects backend pressure, max events, swap, missing VM data and five-second gaps',()=>{
  const row=(role,n,source)=>({type:'cgroup',role,source:group(n,source)});
  assert.equal(campaignResourceStop(row('runner',4*GiB),limit),null);
  assert.equal(campaignResourceStop(row('runner',Math.ceil(limit*.85)),limit),'runner_memory_guard');
  assert.equal(campaignResourceStop(row('backend',Math.ceil(4*GiB*.85)),limit),'backend_memory_guard');
  assert.equal(campaignResourceStop({...row('runner',GiB),source:group(GiB).replace('max 0','max 1')},limit),'runner_memory_events');
  assert.equal(campaignResourceStop(row('runner',GiB,''),limit),'invalid_vm_telemetry');
  assert.equal(campaignResourceStop(host(vm(24*GiB,0)),limit),'vm_swap_pressure');
  assert.equal(campaignResourceStop(host(vm(GiB/2)),limit),'vm_memory_reserve');
  const rows=[{...host(vm()),elapsedMs:0},{...host(vm()),elapsedMs:1000}];
  assertHostMemoryCoverage(rows,limit);
  assert.throws(()=>assertHostMemoryCoverage([rows[0],{...rows[1],elapsedMs:6000}],limit));
  assert.throws(()=>assertHostMemoryCoverage([rows[0],{...host(vm(24*GiB,0)),elapsedMs:1000}],limit));
});
