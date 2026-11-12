import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {startRunnerProfiling,runnerProfilingPlan} from '../src/runner-profiling.js';import {baselinePlan} from '../scripts/baseline.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const config={rampSeconds:1,warmupSeconds:1,measurementSeconds:4};
test('diagnostics are explicit, bounded, single-worker and leave workload/resources unchanged',()=>{
 const args=['--prepared-sessions','--vus=10000','--runner-cpus=8','--runner-memory=48g','--runner-gc=150','--payload-cache=320m'];
 assert.deepEqual(baselinePlan([...args,'--diagnostic-profile']),{...baselinePlan(args),diagnosticProfile:true});
 for(const flag of ['--prepared-sessions','--runner-cpus=8','--runner-memory=48g','--runner-gc=150'])assert.throws(()=>baselinePlan([...args.filter(a=>a!==flag),'--diagnostic-profile']));
 for(const extra of ['--diagnostic-profile','--runner-workers=2'])assert.throws(()=>baselinePlan([...args,'--diagnostic-profile',extra]));
 const plan=runnerProfilingPlan({rampSeconds:30,warmupSeconds:60,measurementSeconds:120});assert.equal(plan.cpuDurationSeconds,118);assert.equal(plan.measurementOffsetMs,90000);assert.equal(plan.forcedGc,false);assert.equal(plan.capacityEligible,false);assert.equal(plan.binding,'127.0.0.1:6565');
});
async function fixture(t,status=200){
 const directory=mkdtempSync(tmpdir()+'/runner-profile-'),requests=[],bytes=gzipSync('unit profile fixture');
 const server=createServer(async(req,res)=>{requests.push(req.url);if(status!==200){res.writeHead(status);res.end();return;}
  if(req.url==='/metrics'){res.writeHead(200,{'content-type':'text/plain'});res.end('go_gc_duration_seconds_count 1\nprocess_start_time_seconds 1\n');return;}
  if(req.url.startsWith('/debug/pprof/profile?'))await sleep(Number(new URL(req.url,'http://local').searchParams.get('seconds'))*1000);
  res.writeHead(200,{'content-type':'application/octet-stream'});res.end(bytes);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true});});
 return {directory,requests,bytes,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
test('phase-aligned capture retains originals/hashes, samples runtime and never forces GC',{timeout:12000},async t=>{
 const f=await fixture(t),p=startRunnerProfiling({...f,config}),at=Date.now();p.onRelease({event:'released',at,releaseAt:at+100});
 await sleep(6500);const report=await p.stop();assert.equal(report.state,'complete');assert.equal(report.runtimeCoverage,true);assert.equal(report.capacityEligible,false);assert.equal(report.jobs.length,4);
 for(const name of ['heap-before','allocs-before','cpu','heap-late','allocs-late'])assert.deepEqual(readFileSync(`${f.directory}/profiling/${name}.pprof`),f.bytes);
 const cpu=report.jobs.find(j=>j.name==='cpu').result;assert.equal(cpu.sha256,createHash('sha256').update(f.bytes).digest('hex'));assert.ok(f.requests.includes('/debug/pprof/profile?seconds=2'));assert.ok(f.requests.every(p=>!p.includes('gc=')));
 assert.throws(()=>p.onRelease({event:'released',at,releaseAt:at+100}));assert.deepEqual(await p.stop(),report);
});
test('cancellation before capture closes timers and reports incomplete, not successful empty evidence',async t=>{
 const f=await fixture(t),p=startRunnerProfiling({...f,config}),at=Date.now();p.onRelease({event:'released',at,releaseAt:at+1000});const report=await p.stop();assert.equal(report.state,'incomplete');assert.equal(report.runtimeSamples,0);assert.ok(report.jobs.every(j=>j.state==='skipped'));assert.equal(f.requests.length,0);
});
test('HTTP capture failure is retained and cannot produce a complete diagnostic',async t=>{
 const f=await fixture(t,503),p=startRunnerProfiling({...f,config}),at=Date.now();p.onRelease({event:'released',at,releaseAt:at+25});await sleep(300);const report=await p.stop();assert.equal(report.state,'incomplete');assert.ok(report.issues.some(i=>i.startsWith('before:')));assert.equal(existsSync(`${f.directory}/profiling/heap-before.pprof`),false);
});
