import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {runnerBudget} from '../src/calibration-runner.js';
import {campaignCpuPressure} from '../src/campaign.js';

test('six CPUs are explicit and restricted to a single prepared 1500-user point or smoke',()=>{
  for(const selector of ['--vus=1500','--smoke']){
    const args=['--prepared-sessions',selector],previous=baselinePlan(args);
    assert.deepEqual(baselinePlan([...args,'--runner-cpus=6']),{...previous,runnerBudget:{cpus:6,memoryBytes:17179869184},runnerProfile:'6cpu-16g'});
    assert.equal(previous.runnerBudget.cpus,4);
  }
  for(const args of [[],['--campaign','--vus=1500'],['--prepared-sessions','--vus=1200'],['--prepared-sessions','--vus=1500','--runner-cpus=6'],['--prepared-sessions','--vus=1500','--campaign']])assert.throws(()=>baselinePlan([...args,'--runner-cpus=6']));
  const p=baselinePlan(['--prepared-sessions','--vus=1500','--runner-cpus=6','--prepared-template=/private/master.json']);
  assert.equal(p.preparedTemplatePath,'/private/master.json');assert.equal(p.trials,1);assert.equal(p.runnerBudget.cpus,6);
});

test('supervisor binds six CPU profile to real workload identity and unchanged memory',()=>{
  assert.deepEqual(runnerBudget('social-Abc123','6cpu-16g'),{cpus:6,memoryBytes:17179869184});
  assert.throws(()=>runnerBudget('calibration-Abc123-400','6cpu-16g'));
  assert.throws(()=>runnerBudget('social-Abc123','6cpu-4g'));
});

test('CPU pressure follows the allocated budget, preserving the 90 percent guard',()=>{
  const start=Date.parse('2026-11-05T00:00:00Z');
  const samples=cores=>[0,5000].map(ms=>({at:new Date(start+ms).toISOString(),elapsedMs:ms,source:`[cpu.stat]\nusage_usec ${Math.round(ms*cores*1000)}\n`}));
  assert.equal(campaignCpuPressure(samples(3.64),start,120),true);
  assert.equal(campaignCpuPressure(samples(3.64),start,120,6),false);
  assert.equal(campaignCpuPressure(samples(5.39),start,120,6),false);
  assert.equal(campaignCpuPressure(samples(5.4),start,120,6),true);
  assert.equal(campaignCpuPressure(samples(6),start+10000,120,6),false);
  assert.throws(()=>campaignCpuPressure(samples(1),start,120,10));
});
