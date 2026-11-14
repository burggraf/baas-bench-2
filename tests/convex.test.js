import test from 'node:test';
import assert from 'node:assert/strict';
import {convexClient} from '../src/convex.js';
import {convexPlan} from '../scripts/convex.js';
import {cleanupAllowance,cleanupDelay} from '../src/prepared-cleanup.js';
const flags=['--prepared-sessions','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m','--optimized-setup'];
test('Convex capacity plan preserves full dataset, budgets and admission deadline',()=>{
 const p=convexPlan([...flags,'--vus=1000']);assert.equal(p.config.dataset.users,15000);assert.equal(p.config.dataset.postsPerUser,10);assert.equal(p.config.dataset.likesPerUser,10);assert.equal(p.config.measurementSeconds,120);assert.equal(p.config.authPreparation.timeoutSeconds,400);assert.equal(p.fixturePreparationTimeoutSeconds,null);assert.equal(p.runnerBudget.cpus,9);assert.equal(p.validationDataset,false);
 assert.equal(convexPlan([...flags,'--smoke']).config.vus,2);
 assert.throws(()=>convexPlan([...flags,'--vus=15001']));assert.throws(()=>convexPlan([...flags,'--vus=1000','--surprise']));
});
test('Convex uses official SDK fetch and handles native auth error envelopes',async()=>{
 assert.throws(()=>convexClient('https://example.com',fetch));
 let calls=[];const c=convexClient('http://127.0.0.1:4000',async(url,init)=>{calls.push({url,args:JSON.parse(init.body),headers:init.headers});return new Response(JSON.stringify({status:'success',value:{status:'error',userError:{error:'INVALID_CREDENTIALS'}}}),{status:200});});
 await assert.rejects(c.login('username','wrongpassword'));assert.equal(c.user(),null);assert.equal(calls[0].url,'http://127.0.0.1:4000/api/mutation');assert.equal(calls[0].args.path,'auth:signInWithUsernamePassword');assert.equal(calls[0].headers.Authorization,undefined);
});
test('Convex final signout pacing leaves application deadlines unchanged',()=>{
 const c=convexPlan([...flags,'--vus=1000']).config;assert.equal(cleanupAllowance(c,'convex'),200);const end=1000+210000;assert.equal(cleanupDelay(c,1000,1,end,'convex'),0);assert.equal(cleanupDelay(c,1000,1000,end,'convex'),199.8);assert.equal(cleanupAllowance(c,'pocketbase'),0);
});
