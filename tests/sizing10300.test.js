import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {payloadCachePlan} from '../src/payload-cache.js';

const args=['--prepared-sessions','--vus=10300','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];

test('10300-user refinement preserves the fixed-dataset profile and proportional preparation policy',()=>{
  const previous=baselinePlan(args.map(arg=>arg==='--vus=10300'?'--vus=10000':arg)),plan=baselinePlan(args);
  assert.deepEqual(plan,{...previous,config:{...previous.config,vus:10300,authPreparation:{...previous.config.authPreparation,timeoutSeconds:2260}}});
  assert.deepEqual(baselinePlan(args.slice().reverse()),plan);
  assert.deepEqual(plan.config.dataset,{profile:'social-baseline-15000',users:15000,postsPerUser:10,likesPerUser:10});
  assert.deepEqual(plan.runnerBudget,{cpus:9,memoryBytes:48*2**30});assert.equal(plan.config.authPreparation.loginsPerSecond,5);
  const cache=payloadCachePlan(plan.config,plan.payloadCacheBytes);
  assert.equal(cache.slotsPerUser,32);assert.equal(cache.records,329600);assert.equal(cache.budgetBytes,480*1024*1024);
});

test('10300-user refinement rejects incomplete profiles, ambiguous cohorts and unsupported counts',()=>{
  for(const flag of args)assert.throws(()=>baselinePlan(args.filter(arg=>arg!==flag)));
  for(const extra of ['--vus=10300','--vus=10000','--vus=10625','--vus=11250','--vus=12500','--runner-cpus=9','--runner-workers=2','--diagnostic-profile','--smoke'])assert.throws(()=>baselinePlan([...args,extra]));
  for(const cpus of [7,8,10])assert.throws(()=>baselinePlan(args.map(arg=>arg==='--runner-cpus=9'?`--runner-cpus=${cpus}`:arg)));
  assert.throws(()=>baselinePlan(args.map(arg=>arg==='--payload-cache=480m'?'--payload-cache=320m':arg)));
  for(const vus of [9999,10001,10299,10301,10500,10624,10626,11000,11251,15000])assert.throws(()=>baselinePlan(args.map(arg=>arg==='--vus=10300'?`--vus=${vus}`:arg)));
});
