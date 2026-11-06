import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {runnerBudget} from '../src/calibration-runner.js';
import {campaignCpuPressure} from '../src/campaign.js';

test('seven CPUs select one prepared point or correctness smoke without changing defaults',()=>{
  for(const selector of ['--vus=2000','--smoke']){
    const args=['--prepared-sessions',selector],previous=baselinePlan(args);
    assert.deepEqual(baselinePlan([...args,'--runner-cpus=7']),{...previous,runnerBudget:{cpus:7,memoryBytes:17179869184},runnerProfile:'7cpu-16g'});
    assert.equal(previous.runnerBudget.cpus,4);
  }
  for(const args of [[],['--campaign','--vus=2000'],['--prepared-sessions','--vus=1500'],['--prepared-sessions','--vus=2001'],['--prepared-sessions','--vus=2000','--runner-cpus=6'],['--prepared-sessions','--vus=2000','--runner-cpus=7'],['--prepared-sessions','--vus=2000','--campaign']])assert.throws(()=>baselinePlan([...args,'--runner-cpus=7']));
  const p=baselinePlan(['--prepared-sessions','--vus=2000','--runner-cpus=7','--prepared-template=/private/master.json']);
  assert.equal(p.trials,1);assert.equal(p.preparedTemplatePath,'/private/master.json');assert.equal(p.runnerBudget.cpus,7);
  assert.equal(baselinePlan(['--prepared-sessions','--vus=1500','--runner-cpus=6']).runnerBudget.cpus,6);
});

test('seven-CPU supervisor budget retains identity restrictions and 16-GiB memory',()=>{
  assert.deepEqual(runnerBudget('social-Abc123','7cpu-16g'),{cpus:7,memoryBytes:17179869184});
  for(const [id,profile]of [['calibration-Abc123-400','7cpu-16g'],['social-Abc123','7cpu-4g'],['social-Abc123','8cpu-16g']])assert.throws(()=>runnerBudget(id,profile));
});

test('seven-CPU pressure uses the same 90-percent window policy',()=>{
  const start=Date.parse('2026-11-05T00:00:00Z');
  const samples=cores=>[0,5000].map(ms=>({at:new Date(start+ms).toISOString(),elapsedMs:ms,source:`[cpu.stat]\nusage_usec ${Math.round(ms*cores*1000)}\n`}));
  assert.equal(campaignCpuPressure(samples(6.29),start,120,7),false);
  assert.equal(campaignCpuPressure(samples(6.3),start,120,7),true);
  assert.equal(campaignCpuPressure(samples(5.4),start,120,6),true);
  assert.equal(campaignCpuPressure(samples(5.4),start,120,7),false);
  assert.throws(()=>campaignCpuPressure(samples(1),start,120,8));
});


test('seven-CPU stepping supports fresh 500-user increments with proportional auth preparation only',()=>{
  const base=baselinePlan(['--prepared-sessions','--vus=2000','--runner-cpus=7','--runner-gc=150']);
  for(let vus=2000;vus<=10000;vus+=500){
    const plan=baselinePlan(['--prepared-sessions',`--vus=${vus}`,'--runner-cpus=7','--runner-gc=150','--prepared-template=/private/master.json']);
    assert.equal(plan.trials,1);assert.equal(plan.config.vus,vus);assert.equal(plan.runnerGc,150);
    assert.deepEqual(plan.runnerBudget,base.runnerBudget);
    assert.deepEqual(plan.config,{...base.config,vus,authPreparation:{loginsPerSecond:5,timeoutSeconds:vus/5+200}});
    assert.equal(plan.preparedTemplatePath,'/private/master.json');
  }
  for(const vus of [1999,2001,2499,2501,9999,10500])assert.throws(()=>baselinePlan(['--prepared-sessions',`--vus=${vus}`,'--runner-cpus=7']));
  assert.throws(()=>baselinePlan(['--prepared-sessions','--vus=3000']),'Default profile keeps its original preparation deadline');
});
