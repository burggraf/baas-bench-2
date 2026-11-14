import test from 'node:test';import assert from 'node:assert/strict';
import {campaignResourceStop} from '../src/campaign.js';import {summarizeResources} from '../src/resources.js';
import {supabasePlan} from '../scripts/supabase.js';import {pocketbasePlan} from '../scripts/pocketbase.js';
const children=()=>Array.from({length:4},(_,i)=>({id:'service-'+i,running:true,health:'healthy',restarts:0,oomKilled:false,cgroupParent:'owned-group'}));
test('a failing Supabase sibling stops load even while the gateway is healthy',()=>{
 const row={type:'lifecycle',role:'backend',source:{running:true,health:'healthy',oomKilled:false,aggregateScope:'supabase-api-stack',children:children()}};
 assert.equal(campaignResourceStop(row,51539607552),null);
 for(const patch of [{running:false},{health:'unhealthy'},{restarts:1},{oomKilled:true}]){
  const bad=structuredClone(row);Object.assign(bad.source.children[1],patch);assert.equal(campaignResourceStop(bad,51539607552),'backend_stack_instability');
 }
});
test('aggregate Supabase CPU comes from shared cgroup counters, not idle gateway Docker stats',()=>{
 const cg=n=>`[cpu.stat]\nusage_usec ${n}\nthrottled_usec 0\n[memory.current]\n1000000\n[memory.peak]\n2000000\n[memory.events]\noom 0\noom_kill 0\n`;
 const rows=[];
 for(const role of ['backend','runner'])for(const elapsedMs of [0,1000,2000]){
  rows.push({type:'lifecycle',role,elapsedMs,source:{id:role,startedAt:'start',status:role==='runner'&&elapsedMs===2000?'exited':'running',running:!(role==='runner'&&elapsedMs===2000),health:role==='backend'?'healthy':null,restarts:0,oomKilled:false,exitCode:0,...(role==='backend'?{aggregateScope:'supabase-api-stack',children:children()}: {})}});
  rows.push({type:'stats',role,elapsedMs,source:{CPUPerc:'1.00%'}});
  rows.push({type:'cgroup',role,elapsedMs,source:cg(elapsedMs*900)});
 }
 const summary=summarizeResources(rows);assert.equal(summary.valid,true);assert.equal(summary.containers.backend.peakCpuCores,.9);
 const modified=structuredClone(rows);modified.findLast(r=>r.role==='backend'&&r.type==='lifecycle').source.children[1].id='replaced';assert.equal(summarizeResources(modified).valid,false);
});
test('Supabase uses the same dataset, pacing and runner budget as the PocketBase comparison',()=>{
 const args=['--prepared-sessions','--vus=3500','--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];const a=supabasePlan(args),b=pocketbasePlan(args);
 for(const key of ['config','runnerProfile','runnerBudget','runnerGc','payloadCacheBytes'])assert.deepEqual(a[key],b[key]);
 assert.throws(()=>supabasePlan(args.filter(x=>x!=='--runner-memory=48g')));
});

test('Supabase untimed fixture setup has no elapsed-time deadline; login/workload clocks stay bounded',()=>{
 const flags=['--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];
 const p=supabasePlan(['--prepared-sessions','--vus=1000',...flags]);
 assert.equal(p.fixturePreparationTimeoutSeconds,null);assert.equal(p.config.authPreparation.timeoutSeconds,400);
 assert.equal(p.config.authPreparation.loginsPerSecond,5);assert.equal(p.config.measurementSeconds,120);
 assert.equal(supabasePlan(['--prepared-sessions','--smoke',...flags]).fixturePreparationTimeoutSeconds,null);
});
