import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {baselinePlan} from '../scripts/baseline.js';
import * as supervisor from '../src/calibration-runner.js';
import * as safety from '../src/campaign.js';

const GiB=1073741824;
const vm=(available=6*GiB,swapFree=9*GiB)=>`MemTotal: ${8*GiB/1024} kB\nMemAvailable: ${available/1024} kB\nSwapTotal: ${9*GiB/1024} kB\nSwapFree: ${swapFree/1024} kB\n`;
test('only the approved one-trial 1000-user 4-GiB sizing pair or tiny 4-GiB correctness smoke is allowed',()=>{
  const p=baselinePlan(['--workload','--vus=1000','--runner-memory=4g']);
  assert.equal(p.workload,true);assert.equal(p.trials,1);assert.equal(p.campaign,undefined);assert.equal(p.hostSafety,true);assert.equal(p.runnerProfile,'4cpu-4g');
  assert.deepEqual(p.runnerBudget,{cpus:4,memoryBytes:4*GiB});assert.deepEqual(p.config,baselinePlan(['--campaign']).config);
  const s=baselinePlan(['--workload','--smoke','--runner-memory=4g']);assert.equal(s.config.vus,2);assert.equal(s.config.dataset.users,4);assert.equal(s.hostSafety,true);assert.equal(s.trials,1);
  assert.equal(baselinePlan(['--workload']).runnerBudget.memoryBytes,2*GiB);assert.equal(baselinePlan(['--campaign']).runnerBudget.memoryBytes,2*GiB);
  for(const args of [['--workload','--vus=1000'],['--runner-memory=4g'],['--workload','--runner-memory=4g'],['--campaign','--runner-memory=4g'],['--workload','--vus=100','--runner-memory=4g'],['--workload','--vus=1000','--runner-memory=4g','--smoke'],['--workload','--vus=1000','--runner-memory=4g','--runner-memory=4g'],['--workload','--vus=1000','--runner-memory=8g']])assert.throws(()=>baselinePlan(args));
});
test('4-GiB discovery points are one bounded candidate, while tiny campaign smoke and original defaults remain separate',()=>{
  for(const vus of [1000,1500,2000,4000,8000]){
    const p=baselinePlan(['--campaign',`--vus=${vus}`,'--runner-memory=4g']);
    assert.equal(p.campaign,true);assert.equal(p.trials,1);assert.equal(p.config.vus,vus);assert.equal(p.search.startVus,vus);assert.equal(p.search.minVus,1000);assert.equal(p.search.maxVus,8000);assert.equal(p.search.maxTrials,1);assert.equal(p.hostSafety,true);assert.equal(p.runnerProfile,'4cpu-4g');
    assert.deepEqual(p.config,{...baselinePlan(['--campaign']).config,vus});assert.deepEqual(p.runnerBudget,{cpus:4,memoryBytes:4*GiB});
  }
  const smoke=baselinePlan(['--campaign','--smoke','--runner-memory=4g']);assert.equal(smoke.trials,baselinePlan(['--campaign','--smoke']).trials);assert.deepEqual(smoke.search,baselinePlan(['--campaign','--smoke']).search);assert.equal(smoke.config.dataset.users,4);assert.equal(smoke.runnerBudget.memoryBytes,4*GiB);
  assert.equal(baselinePlan(['--campaign']).runnerBudget.memoryBytes,2*GiB);
  for(const args of [['--campaign','--runner-memory=4g'],['--campaign','--vus=999','--runner-memory=4g'],['--campaign','--vus=8001','--runner-memory=4g'],['--campaign','--vus=2e3','--runner-memory=4g'],['--campaign','--vus=2000.0','--runner-memory=4g'],['--campaign','--vus=2000','--runner-memory=4g','--smoke'],['--campaign','--vus=2000','--runner-memory=4g','--workload'],['--campaign','--vus=2000','--runner-memory=4g','--vus=2000']])assert.throws(()=>baselinePlan(args));
});

test('supervisor permits explicit 4-GiB profile only for a real workload and never silently changes defaults',()=>{
  assert.deepEqual(supervisor.runnerBudget('social-Abc123','4cpu-4g'),{cpus:4,memoryBytes:4*GiB});
  assert.deepEqual(supervisor.runnerBudget('social-Abc123'),{cpus:4,memoryBytes:2*GiB});
  for(const [id,p]of [['calibration-Abc123-400','4cpu-4g'],['social-Abc123','8cpu-4g'],['social-Abc123','4cpu-8g']])assert.throws(()=>supervisor.runnerBudget(id,p));
});
test('VM memory gate requires original complete counters, 1-GiB live reserve, zero VM swap use and 4.4-GiB prestart reserve',()=>{
  assert.equal(typeof safety.vmMemoryStop,'function');
  assert.equal(safety.vmMemoryStop(vm()),null);assert.equal(safety.vmMemoryStop(vm(),true),null);
  assert.equal(safety.vmMemoryStop(vm(4*GiB),true),'vm_memory_reserve');assert.equal(safety.vmMemoryStop(vm(GiB/2)),'vm_memory_reserve');
  assert.equal(safety.vmMemoryStop(vm(6*GiB,8*GiB)),'vm_swap_pressure');
  for(const source of [null,undefined,123,'',vm().replace('MemAvailable','Other'),vm().replace('MemAvailable:','MemAvailable: bad'),vm()+vm(),vm(9*GiB)])assert.equal(safety.vmMemoryStop(source),'invalid_vm_telemetry');
});
test('4-GiB safety reuses real memory events but requires VM memory and normal original macOS pressure samples',()=>{
  const group=n=>`[cpu.stat]\nusage_usec 1\n[memory.current]\n${n}\n[memory.events]\nmax 0\noom 0\noom_kill 0\n[vm.meminfo]\n${vm()}`;
  assert.equal(safety.campaignResourceStop({type:'cgroup',role:'runner',source:group(2*GiB)},4*GiB),null);
  assert.equal(safety.campaignResourceStop({type:'cgroup',role:'runner',source:group(2*GiB)}),'runner_memory_guard');
  assert.equal(safety.campaignResourceStop({type:'cgroup',role:'runner',source:group(3.5*GiB)},4*GiB),'runner_memory_guard');
  assert.equal(safety.campaignResourceStop({type:'cgroup',role:'runner',source:group(GiB).replace(vm(),'')},4*GiB),'invalid_vm_telemetry');
  assert.equal(safety.campaignResourceStop({type:'cgroup',role:'runner',source:group(GiB).replace('[vm.meminfo]','[vmXmeminfo]')},4*GiB),'invalid_vm_telemetry');
  assert.equal(safety.campaignResourceStop({type:'host_memory',role:'host',source:{stdout:'1\n',stderr:'',exitCode:0}},4*GiB),null);
  assert.equal(safety.campaignResourceStop({type:'host_memory',role:'host',source:{stdout:'2\n',stderr:'',exitCode:0}},4*GiB),'macos_memory_pressure');
  assert.equal(safety.campaignResourceStop({type:'host_memory',role:'host',source:{stdout:'',stderr:'error',exitCode:1}},4*GiB),'invalid_host_telemetry');
  assert.throws(()=>safety.campaignResourceStop({type:'stats'},8*GiB));
});
test('4-GiB supervisor can retain original VM meminfo alongside original self-cgroups without changing default snapshots',t=>{
  const dir=mkdtempSync(join(tmpdir(),'sizing4g-cgroup-'));t.after(()=>rmSync(dir,{recursive:true}));
  for(const name of ['cpu.stat','memory.current','memory.peak','memory.events'])writeFileSync(join(dir,name),'0\n');
  const file=join(dir,'vm');writeFileSync(file,vm());
  assert.ok(supervisor.readCgroupSnapshot(dir,file).includes(`[vm.meminfo]\n${vm()}`));assert.ok(!supervisor.readCgroupSnapshot(dir).includes('[vm.meminfo]'));
});
test('host pressure samples must span the run without missing, invalid or greater-than-five-second gaps',()=>{
  assert.equal(typeof safety.assertHostMemoryCoverage,'function');
  const row=elapsedMs=>({type:'host_memory',role:'host',elapsedMs,source:{stdout:'1\n',stderr:'',exitCode:0}});
  safety.assertHostMemoryCoverage([row(0),row(1000),row(3000)]);
  for(const rows of [[],[row(0)],[row(0),row(6000)],[row(6000),row(7000)],[row(0),row(1000),{type:'lifecycle',elapsedMs:8000}],[row(0),{...row(1000),source:{stdout:'4',stderr:'',exitCode:0}}]])assert.throws(()=>safety.assertHostMemoryCoverage(rows));
});
