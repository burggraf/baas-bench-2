import test from 'node:test';import assert from 'node:assert/strict';
import {campaignResourceStop} from '../src/campaign.js';import {summarizeResources} from '../src/resources.js';
const children=()=>['db','convex'].map(id=>({id,running:true,health:'healthy',restarts:0,oomKilled:false,cgroupParent:'owned-group'}));
test('Convex stops when either member of its shared PostgreSQL stack fails',()=>{
 const row={type:'lifecycle',role:'backend',source:{running:true,health:'healthy',oomKilled:false,aggregateScope:'convex-postgres-stack',children:children()}};
 assert.equal(campaignResourceStop(row,51539607552),null);
 for(const patch of [{running:false},{health:'unhealthy'},{restarts:1},{oomKilled:true}]){const bad=structuredClone(row);Object.assign(bad.source.children[0],patch);assert.equal(campaignResourceStop(bad,51539607552),'backend_stack_instability');}
 const missing=structuredClone(row);missing.source.children.pop();assert.equal(campaignResourceStop(missing,51539607552),'backend_stack_instability');
});
test('Convex CPU/memory evidence covers the parent cgroup and detects replaced database instances',()=>{
 const rows=[],cg=n=>`[cpu.stat]\nusage_usec ${n}\nthrottled_usec 0\n[memory.current]\n123456789\n[memory.peak]\n123456789\n[memory.events]\noom 0\noom_kill 0\n`;
 for(const role of ['backend','runner'])for(const elapsedMs of [0,1000,2000]){
  rows.push({type:'lifecycle',role,elapsedMs,source:{id:role,startedAt:'start',status:role==='runner'&&elapsedMs===2000?'exited':'running',running:!(role==='runner'&&elapsedMs===2000),health:role==='backend'?'healthy':null,restarts:0,oomKilled:false,exitCode:0,...(role==='backend'?{aggregateScope:'convex-postgres-stack',children:children()}: {})}});
  rows.push({type:'stats',role,elapsedMs,source:{CPUPerc:'1.00%'}});rows.push({type:'cgroup',role,elapsedMs,source:cg(elapsedMs*800)});
 }
 const r=summarizeResources(rows);assert.equal(r.valid,true);assert.equal(r.containers.backend.peakCpuCores,.8);assert.equal(r.containers.backend.peakMemoryBytes,123456789);
 const changed=structuredClone(rows);changed.findLast(x=>x.role==='backend'&&x.type==='lifecycle').source.children[0].id='new-db';assert.equal(summarizeResources(changed).valid,false);
});
