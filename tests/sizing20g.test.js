import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {runnerBudget,runnerGcEnvironment} from '../src/calibration-runner.js';
import {prestartMemoryReserve,vmMemoryStop,campaignResourceStop,campaignCpuPressure} from '../src/campaign.js';
const GiB=1073741824,args=['--prepared-sessions','--vus=4500','--runner-cpus=7','--runner-gc=150'];
const vm=(available=24*GiB,free=GiB)=>`MemTotal: ${32*GiB/1024} kB\nMemAvailable: ${available/1024} kB\nSwapTotal: ${GiB/1024} kB\nSwapFree: ${free/1024} kB\n`;
test('20GiB is opt-in, coupled to seven CPUs/GC150 and preserves workload and defaults',()=>{
  const before=baselinePlan(args),after=baselinePlan([...args,'--runner-memory=20g']);
  assert.deepEqual(after,{...before,runnerProfile:'7cpu-20g',runnerBudget:{cpus:7,memoryBytes:20*GiB}});
  assert.equal(before.runnerBudget.memoryBytes,16*GiB);
  assert.deepEqual(baselinePlan(['--runner-memory=20g',...args.slice().reverse()]),after);
  const smoke=baselinePlan([...args.filter(a=>!a.startsWith('--vus=')),'--smoke','--runner-memory=20g']);assert.equal(smoke.config.vus,2);
  for(const removed of ['--prepared-sessions','--runner-cpus=7','--runner-gc=150'])assert.throws(()=>baselinePlan([...args.filter(a=>a!==removed),'--runner-memory=20g']));
  for(const extra of ['--runner-memory=20g','--runner-memory=16g','--runner-memory=4g','--backend-memory-stop=95'])assert.throws(()=>baselinePlan([...args,'--runner-memory=20g',extra]));
  assert.throws(()=>baselinePlan(['--prepared-sessions','--vus=1500','--runner-cpus=6','--runner-gc=150','--runner-memory=20g']));
});
test('20GiB supervisor enforces identity and explicit GC environment',()=>{
  assert.deepEqual(runnerBudget('social-Abc123','7cpu-20g'),{cpus:7,memoryBytes:20*GiB});
  assert.throws(()=>runnerBudget('calibration-Abc123-400','7cpu-20g'));
  assert.deepEqual(runnerGcEnvironment('7cpu-20g',150),{GOGC:'150',GOMEMLIMIT:'15GiB'});
  assert.throws(()=>runnerGcEnvironment('7cpu-20g'));
  for(const gc of [200,100,'150',null])assert.throws(()=>runnerGcEnvironment('7cpu-20g',gc));
});
test('20GiB keeps 85% memory, full backend reserve, swap/host guards and 90% CPU policy',()=>{
  assert.equal(prestartMemoryReserve(20*GiB),22*GiB);
  assert.equal(vmMemoryStop(vm(22*GiB),true,20*GiB),null);
  assert.equal(vmMemoryStop(vm(22*GiB-1024),true,20*GiB),'vm_memory_reserve');
  assert.equal(vmMemoryStop(vm(24*GiB,0),true,20*GiB),'vm_swap_pressure');
  const row=(role,bytes,source=vm())=>({type:'cgroup',role,source:`[cpu.stat]\nusage_usec 1\n[memory.current]\n${bytes}\n[memory.events]\nmax 0\noom 0\noom_kill 0\n[vm.meminfo]\n${source}`});
  assert.equal(campaignResourceStop(row('runner',17*GiB-1),20*GiB),null);
  assert.equal(campaignResourceStop(row('runner',17*GiB),20*GiB),'runner_memory_guard');
  assert.equal(campaignResourceStop(row('backend',Math.ceil(4*GiB*.85)),20*GiB),'backend_memory_guard');
  assert.equal(campaignResourceStop(row('runner',GiB,vm(GiB/2)),20*GiB),'vm_memory_reserve');
  assert.equal(campaignResourceStop({...row('runner',GiB),source:row('runner',GiB).source.replace('oom 0','oom 1')},20*GiB),'runner_memory_events');
  assert.throws(()=>campaignResourceStop(row('runner',GiB),20*GiB,.95));
  const start=Date.now(),samples=[0,5000].map(ms=>({at:new Date(start+ms).toISOString(),elapsedMs:ms,source:`[cpu.stat]\nusage_usec ${ms*6300}\n`}));
  assert.equal(campaignCpuPressure(samples,start,120,7),true);
});
