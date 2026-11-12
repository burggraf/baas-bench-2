import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {payloadCachePlan} from '../src/payload-cache.js';
const args=['--prepared-sessions','--vus=12500','--runner-cpus=8','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];

test('12500-user refinement keeps the original 15000-account dataset and per-user cache coverage',()=>{
  const previous=baselinePlan(args.map(a=>a==='--vus=12500'?'--vus=15000':a)),plan=baselinePlan(args);
  assert.deepEqual(plan,{...previous,configPath:'configs/prepared-social-12500.json',config:{...previous.config,vus:12500,authPreparation:{...previous.config.authPreparation,timeoutSeconds:2700}}});
  assert.equal(plan.config.dataset.users,15000);assert.equal(plan.config.dataset.postsPerUser,10);assert.equal(plan.config.dataset.likesPerUser,10);assert.equal(plan.config.authPreparation.loginsPerSecond,5);
  const cache=payloadCachePlan(plan.config,plan.payloadCacheBytes);assert.equal(cache.slotsPerUser,32);assert.equal(cache.users,12500);assert.equal(cache.records,400000);assert.equal(cache.budgetBytes,480*1024*1024);
  assert.deepEqual(baselinePlan(args.slice().reverse()),plan);
});

test('12500-user entry rejects unsupported budgets, mismatched caches and unbounded candidate counts',()=>{
  for(const flag of args)assert.throws(()=>baselinePlan(args.filter(a=>a!==flag)));
  for(const extra of ['--runner-workers=2','--diagnostic-profile','--payload-cache=480m','--vus=12500'])assert.throws(()=>baselinePlan([...args,extra]));
  for(const replacement of ['--runner-cpus=7','--runner-cpus=10'])assert.throws(()=>baselinePlan(args.map(a=>a==='--runner-cpus=8'?replacement:a)));
  assert.throws(()=>baselinePlan(args.map(a=>a==='--payload-cache=480m'?'--payload-cache=320m':a)));
  for(const vus of [11000,12000,12501,13000,20000])assert.throws(()=>baselinePlan(args.map(a=>a==='--vus=12500'?`--vus=${vus}`:a)));
});
