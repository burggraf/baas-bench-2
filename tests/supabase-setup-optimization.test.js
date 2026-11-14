import test from 'node:test';import assert from 'node:assert/strict';
import {fixtureSessions} from '../src/supabase-fixture-sessions.js';import {cleanupAllowance,cleanupDelay} from '../src/prepared-cleanup.js';import {supabasePlan} from '../scripts/supabase.js';
const user={username:'alice',password:'secret',id:'id-alice'},token=()=>`e30.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
function factory(counters){return ()=>{let current=null;return {async login(u,p){assert.equal(p,user.password);counters.login++;current=user;},async restoreSession(){counters.restore++;current=user;},user:()=>current,tokens:()=>({auth_token:token(),refresh_token:'private-refresh'}),async logout(){counters.logout++;current=null;return true;}};};}
test('untimed fixture sessions verify one password then restore identities and revoke before measurement',async()=>{
 const c={login:0,restore:0,logout:0},make=factory(c),context=fixtureSessions(make);
 for(let pass=0;pass<4;pass++){const client=make();await context.authorize(client,user);await context.release(client,user);}
 assert.equal(c.login,1);assert.equal(c.restore,3);assert.equal(c.logout,0);
 await assert.rejects(context.authorize(make(),{...user,password:'incorrect'}),/credential changed/);
 await assert.rejects(context.authorize(make(),{...user,id:'other'}),/identity changed/);
 await context.revokeBeforeMeasurement();assert.equal(c.logout,1);
 const client=make();await context.authorize(client,user);assert.equal(c.login,2);
 assert.ok(!JSON.stringify(context).includes('private-refresh'));context.forget(user);await context.close();assert.equal(context.stats.entries,0);
});
test('Supabase only staggers final signout after the unchanged application deadline',()=>{
 const config={vus:1000,rampSeconds:30,warmupSeconds:60,measurementSeconds:120,authPreparation:{loginsPerSecond:5}};
 assert.equal(cleanupAllowance(config,'supabase'),200);assert.equal(cleanupAllowance(config,'pocketbase'),0);
 assert.equal(cleanupDelay(config,1000,1000,211000,'supabase'),199.8);assert.equal(cleanupDelay(config,1000,1,211500,'supabase'),0);assert.equal(cleanupDelay(config,1000,1000,211000,'trailbase'),0);
});
test('small Supabase workflow point is explicit and cannot mix with full template data',()=>{
 const flags=['--prepared-sessions','--vus=100','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m','--optimized-setup','--validation-dataset=1000'];const p=supabasePlan(flags);
 assert.equal(p.config.dataset.users,1000);assert.equal(p.config.measurementSeconds,120);assert.equal(p.validationDataset,true);
 assert.throws(()=>supabasePlan(flags.filter(a=>a!=='--optimized-setup')));assert.throws(()=>supabasePlan([...flags,'--setup-template=/x.json']));
});
