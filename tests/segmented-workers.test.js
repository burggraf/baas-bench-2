import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {gzipSync,gunzipSync} from 'node:zlib';
import {baselinePlan} from '../scripts/baseline.js';
import {mergeWorkerResults} from '../src/merge-worker-results.js';
test('two workers require bounded prepared 8CPU/48GiB/GC150 smoke or 10000',()=>{
 const args=['--prepared-sessions','--vus=10000','--runner-cpus=8','--runner-memory=48g','--runner-gc=150'];
 assert.deepEqual(baselinePlan([...args,'--runner-workers=2']),{...baselinePlan(args),runnerWorkers:2});
 for(const removed of args)assert.throws(()=>baselinePlan([...args.filter(a=>a!==removed),'--runner-workers=2']));
 assert.throws(()=>baselinePlan([...args.map(a=>a==='--vus=10000'?'--vus=5000':a),'--runner-workers=2']));
});
const counter=(metric,value)=>({type:'Point',metric,data:{value,tags:{}}});
function fixture(dir,id,values){
 const metrics={users_finished:{count:1,rate:1,thresholds:{'count==1':false}},action_duration:{count:values.length,avg:0,min:0,max:0,med:0,'p(95)':0,'p(99)':0},auth_failed:{passes:0,fails:1,value:0}};
 const rows=[{type:'Metric',metric:'users_finished',data:{type:'counter'}},{type:'Metric',metric:'action_duration',data:{type:'trend'}},{type:'Metric',metric:'auth_failed',data:{type:'rate'}},counter('users_finished',1),counter('auth_failed',0),...values.map(v=>counter('action_duration',v))];
 writeFileSync(`${dir}/worker-${id}-summary.json`,JSON.stringify({metrics}));writeFileSync(`${dir}/worker-${id}-metrics.json.gz`,gzipSync(rows.map(JSON.stringify).join('\n')+'\n'));
}
test('merged percentiles use original samples rather than worker percentile averages',async()=>{
 const dir=mkdtempSync(tmpdir()+'/worker-merge-');try{
 fixture(dir,1,[1]);fixture(dir,2,[10,20,30,40,50,60,70,80,90]);
 const m=await mergeWorkerResults(dir,{vus:2});assert.equal(m.users_finished.count,2);assert.equal(m.auth_failed.fails,2);assert.ok(Math.abs(m.action_duration['p(95)']-85.5)<1e-10);assert.equal(m.action_duration.count,10);assert.equal(m.users_finished.thresholds['count==2'],false);
 const raw=gunzipSync(readFileSync(dir+'/k6-metrics.json.gz')).toString().trim().split('\n').map(JSON.parse);assert.equal(raw.filter(x=>x.metric==='users_finished'&&x.type==='Point').length,2);
 }finally{rmSync(dir,{recursive:true});}
});
test('merging rejects a worker summary that disagrees with the retained raw stream',async()=>{
 const dir=mkdtempSync(tmpdir()+'/worker-merge-');try{fixture(dir,1,[1]);fixture(dir,2,[2]);const p=dir+'/worker-2-summary.json',s=JSON.parse(readFileSync(p));s.metrics.users_finished.count=2;writeFileSync(p,JSON.stringify(s));await assert.rejects(mergeWorkerResults(dir,{vus:2}));}finally{rmSync(dir,{recursive:true});}
});
