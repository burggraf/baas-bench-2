import assert from 'node:assert/strict';
import {mkdirSync,appendFileSync,createWriteStream,renameSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {performance} from 'node:perf_hooks';

export function runnerProfilingPlan(config) {
  assert.ok(Number.isFinite(config.measurementSeconds)&&config.measurementSeconds>=4);
  const measurementOffsetMs=(config.rampSeconds+config.warmupSeconds)*1000;
  assert.ok(Number.isFinite(measurementOffsetMs)&&measurementOffsetMs>=2000);
  const durationSeconds=Math.floor(config.measurementSeconds-2);
  return {kind:'full-workload-cpu-gc-diagnostic',capacityEligible:false,profilingOverhead:true,forcedGc:false,
    measurementOffsetMs,measurementDurationMs:config.measurementSeconds*1000,
    cpuOffsetMs:1000,cpuDurationSeconds:durationSeconds,
    beforeOffsetMs:-2000,lateOffsetMs:config.measurementSeconds*1000-3000,
    runtimeIntervalMs:1000,runtimeLastOffsetMs:config.measurementSeconds*1000-1000,
    binding:'127.0.0.1:6565',environment:{GODEBUG:'gctrace=1'},
    limitations:['CPU capture excludes measurement edge seconds to finish before native process shutdown.',
      'Heap/alloc profiles are sampled and may reflect the most recently completed GC; no collection is forced.',
      'Profile handlers, runtime sampling and the collector are included in the runner cgroup.']};
}

// Runs in the existing same-cgroup supervisor. It only queries k6's local
// diagnostic listener; business traffic and the preparation gate are unchanged.
export function startRunnerProfiling({directory,config,baseUrl='http://127.0.0.1:6565'}) {
  assert.match(baseUrl,/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
  assert.ok(Number(baseUrl.split(':').at(-1))<=65535);
  const plan=runnerProfilingPlan(config),root=`${directory}/profiling`,began=performance.now(),abort=new AbortController();
  mkdirSync(root,{mode:0o700});
  const now=()=>({at:new Date().toISOString(),elapsedMs:performance.now()-began});
  const emit=(event,fields={})=>appendFileSync(`${root}/events.jsonl`,JSON.stringify({event,...now(),...fields})+'\n');
  const write=(name,value)=>writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2),{mode:0o600});
  write('plan.json',plan);emit('started');
  const jobs=[],timers=new Map(),runtime=[],issues=[];let release=null,stopping=false,finished;
  const delay=ms=>new Promise(resolve=>{
    if(abort.signal.aborted){resolve(false);return;}
    const timer=setTimeout(()=>{timers.delete(timer);resolve(true);},Math.max(0,ms));
    timers.set(timer,()=>resolve(false));
  });
  const schedule=(name,target,work)=>{
    const job={name,state:'pending',scheduledElapsedMs:target-began};jobs.push(job);
    job.promise=(async()=>{
      if(!await delay(target-performance.now())){job.state='skipped';return;}
      job.state='running';job.started=now();emit('capture_started',{name});
      try{job.result=await work();job.state='complete';}
      catch(error){job.state='failed';job.failure={type:error.name,code:error.code??error.cause?.code??null};issues.push(`${name}:${error.name}`);}
      finally{job.finished=now();emit('capture_finished',{name,state:job.state,...(job.failure?{failure:job.failure}:{})});}
    })();
    // Errors are recorded inside the job and cannot become unhandled rejections.
    return job;
  };
  const capture=async(name,path,timeoutMs)=>{
    const started=now(),response=await fetch(baseUrl+path,{redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(timeoutMs)])});
    assert.equal(response.status,200,`Profiling HTTP ${response.status}`);
    assert.match(response.headers.get('content-type')??'',/application\/octet-stream/);
    const target=`${root}/${name}.pprof`,temporary=target+'.partial';assert.equal(existsSync(target),false);
    let bytes=0;const digest=createHash('sha256');
    const meter=new Transform({transform(chunk,_,done){bytes+=chunk.length;if(bytes>64*1024*1024){done(new Error('Profile too large'));return;}digest.update(chunk);done(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal:abort.signal});
    const prefix=readFileSync(temporary).subarray(0,2);assert.equal(prefix.toString('hex'),'1f8b','Expected gzip pprof data');
    renameSync(temporary,target);
    const artifact={name,file:`${name}.pprof`,path,started,finished:now(),bytes,sha256:digest.digest('hex')};emit('artifact',artifact);return artifact;
  };
  const sample=async()=>{
    const row={started:now()};
    try{
      const r=await fetch(baseUrl+'/metrics',{redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(2000)])});
      row.status=r.status;assert.equal(r.status,200);row.body=await r.text();assert.ok(row.body.length>0&&row.body.length<=1024*1024);
      assert.match(row.body,/^go_/m,'Expected Go runtime metrics');row.ok=true;
    }catch(error){row.ok=false;row.failure={type:error.name,code:error.code??error.cause?.code??null};issues.push('runtime_metrics:'+error.name);}
    row.finished=now();runtime.push(row);appendFileSync(`${root}/runtime-metrics.jsonl`,JSON.stringify(row)+'\n');
  };
  const onRelease=row=>{
    assert.equal(release,null,'Only one common release is permitted');assert.equal(stopping,false);
    assert.ok(row?.event==='released'&&Number.isFinite(row.at)&&Number.isFinite(row.releaseAt)&&row.releaseAt>row.at);
    const received=now(),anchor=performance.now()+row.releaseAt-row.at,measurement=anchor+plan.measurementOffsetMs;
    release={event:row,received,measurementAt:row.releaseAt+plan.measurementOffsetMs,endAt:row.releaseAt+plan.measurementOffsetMs+plan.measurementDurationMs};write('release.json',release);emit('release_observed',{measurementAt:release.measurementAt,endAt:release.endAt});
    schedule('before',measurement+plan.beforeOffsetMs,async()=>[
      await capture('heap-before','/debug/pprof/heap',5000),await capture('allocs-before','/debug/pprof/allocs',5000)]);
    schedule('cpu',measurement+plan.cpuOffsetMs,()=>capture('cpu',`/debug/pprof/profile?seconds=${plan.cpuDurationSeconds}`,(plan.cpuDurationSeconds+5)*1000));
    schedule('late',measurement+plan.lateOffsetMs,async()=>[
      await capture('heap-late','/debug/pprof/heap',5000),await capture('allocs-late','/debug/pprof/allocs',5000)]);
    schedule('runtime',measurement+plan.beforeOffsetMs,async()=>{
      const last=measurement+plan.runtimeLastOffsetMs;let next=measurement+plan.beforeOffsetMs;
      while(!abort.signal.aborted&&next<=last){
        if(!await delay(next-performance.now()))break;
        await sample();next=Math.max(next+plan.runtimeIntervalMs,measurement+plan.beforeOffsetMs+Math.ceil((performance.now()-measurement-plan.beforeOffsetMs)/plan.runtimeIntervalMs)*plan.runtimeIntervalMs);
      }
      return {samples:runtime.length};
    });
  };
  const stop=()=>finished??=(async()=>{
    stopping=true;abort.abort();for(const[timer,resolve]of timers){clearTimeout(timer);resolve();}timers.clear();
    await Promise.all(jobs.map(j=>j.promise));
    const sampleTimes=runtime.filter(r=>r.ok).map(r=>Date.parse(r.finished.at));
    const runtimeCoverage=release&&sampleTimes.length>=2&&runtime.every(r=>r.ok)&&sampleTimes[0]<=release.measurementAt&&sampleTimes.at(-1)>=release.endAt-2500&&sampleTimes.every((t,i)=>!i||t>=sampleTimes[i-1]&&t-sampleTimes[i-1]<=5000);
    if(!runtimeCoverage)issues.push('runtime_coverage');
    const complete=release!==null&&jobs.length===4&&jobs.every(j=>j.state==='complete')&&runtimeCoverage;
    const report={kind:plan.kind,capacityEligible:false,profilingOverhead:true,state:complete?'complete':'incomplete',plan,release,
      jobs:jobs.map(({promise,...j})=>j),runtimeSamples:runtime.length,runtimeCoverage:!!runtimeCoverage,issues:[...new Set(issues)],finished:now()};
    write('report.json',report);emit('stopped',{state:report.state});return report;
  })();
  return {onRelease,stop,plan};
}
