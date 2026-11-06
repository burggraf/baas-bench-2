import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {runnerGcEnvironment} from '../src/calibration-runner.js';

test('GC tuning is explicit, preserves the workload and only supports prepared seven-CPU points',()=>{
  for(const selector of ['--vus=2000','--smoke']){
    const args=['--prepared-sessions',selector,'--runner-cpus=7'],previous=baselinePlan(args);
    assert.deepEqual(baselinePlan([...args,'--runner-gc=150']),{...previous,runnerGc:150});
    assert.equal(previous.runnerGc,undefined);
  }
  for(const args of [[],['--campaign'],['--prepared-sessions','--vus=2000'],['--prepared-sessions','--vus=1500','--runner-cpus=6'],['--prepared-sessions','--smoke','--runner-cpus=7','--runner-gc=150']])assert.throws(()=>baselinePlan([...args,'--runner-gc=150']));
  for(const value of ['100','200','off','150x',''])assert.throws(()=>baselinePlan(['--prepared-sessions','--vus=2000','--runner-cpus=7','--runner-gc='+value]));
  const p=baselinePlan(['--runner-gc=150','--prepared-sessions','--vus=2000','--runner-cpus=7','--prepared-template=/private/master.json']);
  assert.equal(p.preparedTemplatePath,'/private/master.json');assert.equal(p.trials,1);
});

test('Go tuning trades memory for CPU while retaining the original cgroup budget',()=>{
  assert.deepEqual(runnerGcEnvironment('7cpu-16g',150),{GOGC:'150',GOMEMLIMIT:'12GiB'});
  for(const profile of ['4cpu-16g','6cpu-16g','7cpu-4g',undefined])assert.throws(()=>runnerGcEnvironment(profile,150));
  for(const gc of [100,200,NaN,'150',null])assert.throws(()=>runnerGcEnvironment('7cpu-16g',gc));
  assert.deepEqual(runnerGcEnvironment('7cpu-16g'),{});
  assert.deepEqual(runnerGcEnvironment(undefined),{});
});
