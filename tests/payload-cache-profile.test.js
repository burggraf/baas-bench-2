import assert from 'node:assert/strict';import test from 'node:test';
import {baselinePlan} from '../scripts/baseline.js';
test('320MiB payload cache requires explicit bounded single-worker prepared TrailBase resources',()=>{
 const args=['--prepared-sessions','--vus=10000','--runner-cpus=8','--runner-memory=48g','--runner-gc=150'];
 const old=baselinePlan(args),next=baselinePlan([...args,'--payload-cache=320m']);assert.deepEqual(next,{...old,payloadCacheBytes:335544320});assert.equal(old.payloadCacheBytes,undefined);
 for(const remove of args)assert.throws(()=>baselinePlan([...args.filter(a=>a!==remove),'--payload-cache=320m']));
 for(const flag of ['--runner-workers=2','--payload-cache=320m','--payload-cache=64m'])assert.throws(()=>baselinePlan([...args,'--payload-cache=320m',flag]));
 assert.throws(()=>baselinePlan([...args.map(a=>a==='--vus=10000'?'--vus=5000':a),'--payload-cache=320m']));
 const smoke=baselinePlan([...args.map(a=>a==='--vus=10000'?'--smoke':a),'--payload-cache=320m']);assert.equal(smoke.config.vus,2);assert.equal(smoke.payloadCacheBytes,335544320);
});
