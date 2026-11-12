import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {payloadCachePlan} from '../src/payload-cache.js';

const args=['--prepared-sessions','--vus=11250','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];

test('11250-user refinement preserves the nine-CPU profile and 15000-account seed dataset',()=>{
  const previous=baselinePlan(args.map(arg=>arg==='--vus=11250'?'--vus=12500':arg)),plan=baselinePlan(args);
  assert.deepEqual(plan,{...previous,config:{...previous.config,vus:11250,authPreparation:{...previous.config.authPreparation,timeoutSeconds:2450}}});
  assert.deepEqual(baselinePlan(args.slice().reverse()),plan);
  assert.deepEqual(plan.config.dataset,{profile:'social-baseline-15000',users:15000,postsPerUser:10,likesPerUser:10});
  assert.equal(plan.config.authPreparation.loginsPerSecond,5);
  const cache=payloadCachePlan(plan.config,plan.payloadCacheBytes);
  assert.equal(cache.slotsPerUser,32);assert.equal(cache.users,11250);assert.equal(cache.records,360000);assert.equal(cache.budgetBytes,480*1024*1024);
});

test('11250 users require the complete nine-CPU single-worker profile and retain bounded selectors',()=>{
  for(const flag of args)assert.throws(()=>baselinePlan(args.filter(arg=>arg!==flag)));
  for(const extra of ['--vus=11250','--vus=12500','--runner-cpus=9','--runner-workers=2','--diagnostic-profile','--payload-cache=480m','--smoke'])assert.throws(()=>baselinePlan([...args,extra]));
  for(const cpus of [7,8,10])assert.throws(()=>baselinePlan(args.map(arg=>arg==='--runner-cpus=9'?`--runner-cpus=${cpus}`:arg)));
  assert.throws(()=>baselinePlan(args.map(arg=>arg==='--payload-cache=480m'?'--payload-cache=320m':arg)));
  for(const vus of [10001,11000,11249,11251,11500,12501,15000])assert.throws(()=>baselinePlan(args.map(arg=>arg==='--vus=11250'?`--vus=${vus}`:arg)));
});
