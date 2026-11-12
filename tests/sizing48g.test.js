import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {runnerBudget,runnerGcEnvironment} from '../src/calibration-runner.js';
import {prestartMemoryReserve,vmMemoryStop,campaignResourceStop,campaignCpuPressure} from '../src/campaign.js';
const GiB=1073741824,args=['--prepared-sessions','--vus=4500','--runner-cpus=8','--runner-gc=150'];
const vm=(available=52*GiB,free=GiB)=>`MemTotal: ${56*GiB/1024} kB\nMemAvailable: ${available/1024} kB\nSwapTotal: ${GiB/1024} kB\nSwapFree: ${free/1024} kB\n`;
test('48GiB is opt-in, coupled to eight CPUs/GC150 and preserves workload and defaults',()=>{
  const before=baselinePlan(args.map(a=>a==='--runner-cpus=8'?'--runner-cpus=7':a)),after=baselinePlan([...args,'--runner-memory=48g']);
  assert.deepEqual(after,{...before,runnerProfile:'8cpu-48g',runnerBudget:{cpus:8,memoryBytes:48*GiB}});
  assert.equal(before.runnerBudget.memoryBytes,16*GiB);
  assert.deepEqual(baselinePlan(['--runner-memory=48g',...args.slice().reverse()]),after);
  const smoke=baselinePlan([...args.filter(a=>!a.startsWith('--vus=')),'--smoke','--runner-memory=48g']);assert.equal(smoke.config.vus,2);
  for(const removed of ['--prepared-sessions','--runner-cpus=8','--runner-gc=150'])assert.throws(()=>baselinePlan([...args.filter(a=>a!==removed),'--runner-memory=48g']));
  for(const extra of ['--runner-memory=48g','--runner-memory=16g','--runner-memory=4g','--backend-memory-stop=95'])assert.throws(()=>baselinePlan([...args,'--runner-memory=48g',extra]));
  assert.throws(()=>baselinePlan(['--prepared-sessions','--vus=1500','--runner-cpus=6','--runner-gc=150','--runner-memory=48g']));
});
test('48GiB supervisor enforces identity and explicit GC environment',()=>{
  assert.deepEqual(runnerBudget('social-Abc123','8cpu-48g'),{cpus:8,memoryBytes:48*GiB});
  assert.throws(()=>runnerBudget('calibration-Abc123-400','8cpu-48g'));
  assert.deepEqual(runnerGcEnvironment('8cpu-48g',150),{GOGC:'150',GOMEMLIMIT:'36GiB'});
  assert.throws(()=>runnerGcEnvironment('8cpu-48g'));
  for(const gc of [200,100,'150',null])assert.throws(()=>runnerGcEnvironment('8cpu-48g',gc));
});
test('48GiB keeps 85% memory, full backend reserve, swap/host guards and 90% CPU policy',()=>{
  assert.equal(prestartMemoryReserve(48*GiB),45.8*GiB);
  assert.equal(vmMemoryStop(vm(Math.ceil(45.8*GiB/1024)*1024),true,48*GiB),null);
  assert.equal(vmMemoryStop(vm(Math.floor(45.8*GiB/1024)*1024-1024),true,48*GiB),'vm_memory_reserve');
  assert.equal(vmMemoryStop(vm(52*GiB,0),true,48*GiB),'vm_swap_pressure');
  const row=(role,bytes,source=vm())=>({type:'cgroup',role,source:`[cpu.stat]\nusage_usec 1\n[memory.current]\n${bytes}\n[memory.events]\nmax 0\noom 0\noom_kill 0\n[vm.meminfo]\n${source}`});
  assert.equal(campaignResourceStop(row('runner',Math.floor(48*GiB*.85)),48*GiB),null);
  assert.equal(campaignResourceStop(row('runner',Math.ceil(48*GiB*.85)),48*GiB),'runner_memory_guard');
  assert.equal(campaignResourceStop(row('backend',Math.ceil(4*GiB*.85)),48*GiB),'backend_memory_guard');
  assert.equal(campaignResourceStop(row('runner',GiB,vm(GiB/2)),48*GiB),'vm_memory_reserve');
  assert.equal(campaignResourceStop({...row('runner',GiB),source:row('runner',GiB).source.replace('oom 0','oom 1')},48*GiB),'runner_memory_events');
  assert.throws(()=>campaignResourceStop(row('runner',GiB),48*GiB,.95));
  const start=Date.now(),samples=[0,5000].map(ms=>({at:new Date(start+ms).toISOString(),elapsedMs:ms,source:`[cpu.stat]\nusage_usec ${ms*7200}\n`}));
  assert.equal(campaignCpuPressure(samples,start,120,8),true);
});
