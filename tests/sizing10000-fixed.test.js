import assert from 'node:assert/strict';
import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
import {payloadCachePlan} from '../src/payload-cache.js';

const args=['--prepared-sessions','--vus=10000','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];

test('10000 active users preserve the larger fixed dataset and nine-CPU profile for a comparable lower point',()=>{
  const previous=baselinePlan(args.map(arg=>arg==='--vus=10000'?'--vus=11250':arg)),plan=baselinePlan(args);
  assert.deepEqual(plan,{...previous,config:{...previous.config,vus:10000,authPreparation:{...previous.config.authPreparation,timeoutSeconds:2200}}});
  assert.deepEqual(baselinePlan(args.slice().reverse()),plan);
  assert.deepEqual(plan.config.dataset,{profile:'social-baseline-15000',users:15000,postsPerUser:10,likesPerUser:10});
  const cache=payloadCachePlan(plan.config,plan.payloadCacheBytes);
  assert.equal(cache.slotsPerUser,32);assert.equal(cache.records,320000);assert.equal(cache.budgetBytes,480*1024*1024);
  const historical=baselinePlan(args.map(arg=>arg==='--runner-cpus=9'?'--runner-cpus=8':arg==='--payload-cache=480m'?'--payload-cache=320m':arg));
  assert.equal(historical.config.dataset.users,10000);assert.equal(historical.runnerBudget.cpus,8);assert.equal(historical.payloadCacheBytes,320*1024*1024);
});

test('fixed-dataset 10000-user point requires the complete profile and rejects ambiguous cohorts',()=>{
  for(const flag of args)assert.throws(()=>baselinePlan(args.filter(arg=>arg!==flag)));
  for(const extra of ['--vus=10000','--vus=11250','--vus=12500','--runner-cpus=9','--runner-workers=2','--diagnostic-profile','--smoke'])assert.throws(()=>baselinePlan([...args,extra]));
  for(const cpus of [7,8,10])assert.throws(()=>baselinePlan(args.map(arg=>arg==='--runner-cpus=9'?`--runner-cpus=${cpus}`:arg)));
  assert.throws(()=>baselinePlan(args.map(arg=>arg==='--payload-cache=480m'?'--payload-cache=320m':arg)));
  for(const vus of [9999,10001,10500,11000,11251,15000])assert.throws(()=>baselinePlan(args.map(arg=>arg==='--vus=10000'?`--vus=${vus}`:arg)));
});
