import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {runnerBudget,runnerGcEnvironment} from '../src/calibration-runner.js';
import {campaignCpuPressure} from '../src/campaign.js';

const args=['--prepared-sessions','--vus=12500','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];

test('nine-CPU confirmation changes only the generator budget, preserving the fixed dataset and workload',()=>{
  const eight=baselinePlan(args.map(arg=>arg==='--runner-cpus=9'?'--runner-cpus=8':arg)),nine=baselinePlan(args);
  assert.deepEqual(nine,{...eight,runnerProfile:'9cpu-48g',runnerBudget:{...eight.runnerBudget,cpus:9}});
  assert.deepEqual(baselinePlan(args.slice().reverse()),nine);
  assert.equal(nine.config.dataset.users,15000);assert.equal(nine.config.authPreparation.timeoutSeconds,2700);
  const smoke=baselinePlan(args.map(arg=>arg==='--vus=12500'?'--smoke':arg));assert.equal(smoke.config.vus,2);assert.equal(smoke.runnerBudget.cpus,9);
});

test('nine CPUs require the explicit single-worker confirmation or smoke with all original memory/cache settings',()=>{
  for(const flag of args)assert.throws(()=>baselinePlan(args.filter(arg=>arg!==flag)));
  for(const extra of ['--runner-cpus=9','--runner-cpus=8','--runner-workers=2','--diagnostic-profile','--payload-cache=480m','--runner-memory=48g'])assert.throws(()=>baselinePlan([...args,extra]));
  for(const vus of [10001,11000,12501,15000,20000])assert.throws(()=>baselinePlan(args.map(arg=>arg==='--vus=12500'?`--vus=${vus}`:arg)));
  assert.throws(()=>baselinePlan(args.map(arg=>arg==='--payload-cache=480m'?'--payload-cache=320m':arg)));
});

test('supervisor enforces nine real CPUs, unchanged memory, and explicit Go processor concurrency',()=>{
  assert.deepEqual(runnerBudget('social-Abc123','9cpu-48g'),{cpus:9,memoryBytes:48*2**30});
  assert.deepEqual(runnerGcEnvironment('9cpu-48g',150),{GOGC:'150',GOMEMLIMIT:'36GiB',GOMAXPROCS:'9'});
  assert.throws(()=>runnerBudget('calibration-Abc123-400','9cpu-48g'));
  for(const gc of [undefined,100,200,'150',null])assert.throws(()=>runnerGcEnvironment('9cpu-48g',gc));
  assert.deepEqual(runnerGcEnvironment('8cpu-48g',150),{GOGC:'150',GOMEMLIMIT:'36GiB'});
});

test('CPU headroom keeps the same five-second and 90 percent rule for the real nine-core quota',()=>{
  const start=Date.parse('2026-11-11T00:00:00Z');
  const samples=(cores,end=5000)=>[0,end].map(ms=>({at:new Date(start+ms).toISOString(),elapsedMs:ms,source:`[cpu.stat]\nusage_usec ${Math.round(ms*cores*1000)}\n`}));
  assert.equal(campaignCpuPressure(samples(7.52),start,120,8),true);
  assert.equal(campaignCpuPressure(samples(7.52),start,120,9),false);
  assert.equal(campaignCpuPressure(samples(8.099),start,120,9),false);
  assert.equal(campaignCpuPressure(samples(8.1),start,120,9),true);
  assert.equal(campaignCpuPressure(samples(9),start,120,9),true);
  assert.equal(campaignCpuPressure(samples(9,4999),start,120,9),false);
  assert.throws(()=>campaignCpuPressure(samples(1),start,120,10));
});
