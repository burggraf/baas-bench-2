import test from 'node:test';
import assert from 'node:assert/strict';
import {pocketbasePlan} from '../scripts/pocketbase.js';
import {baselinePlan} from '../scripts/baseline.js';
const flags=['--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];
test('PocketBase comparison retains the exact TrailBase workload and generator budget',()=>{
 for(const vus of [10000,10300,10625,12500]){
  const args=['--prepared-sessions',`--vus=${vus}`,...flags],p=pocketbasePlan(args),t=baselinePlan(args);
  for(const field of ['config','runnerBudget','runnerProfile','runnerGc','payloadCacheBytes'])assert.deepEqual(p[field],t[field]);
 }
 const p=pocketbasePlan(['--prepared-sessions','--vus=500',...flags]);
 assert.equal(p.config.dataset.users,15000);assert.equal(p.config.authPreparation.loginsPerSecond,5);
 for(const missing of flags)assert.throws(()=>pocketbasePlan(['--prepared-sessions','--vus=500',...flags.filter(f=>f!==missing)]));
 assert.throws(()=>pocketbasePlan(['--prepared-sessions','--vus=15001',...flags]));
});
