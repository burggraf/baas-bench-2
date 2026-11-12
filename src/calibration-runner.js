import assert from 'node:assert/strict';
import {spawn}from'node:child_process';
import{readFileSync,appendFileSync,writeFileSync}from'node:fs';
import{constants}from'node:os';
import{fileURLToPath}from'node:url';

export function runnerBudget(id, profile) {
  assert.match(id,/^(social-[A-Za-z0-9]{6}|calibration-[A-Za-z0-9]{6}-(10|25|40|100|400|1600)(-vu(32|128)|-vu128-(2cpu-1g|4cpu-2g))?)$/);
  if(profile==='9cpu-48g'){assert.match(id,/^social-[A-Za-z0-9]{6}$/);return {cpus:9,memoryBytes:51539607552};}
  if(profile!==undefined){assert.ok(['4cpu-4g','4cpu-16g','6cpu-16g','7cpu-16g','7cpu-20g','8cpu-48g'].includes(profile));assert.match(id,/^social-[A-Za-z0-9]{6}$/);return {cpus:profile==='8cpu-48g'?8:profile.startsWith('7cpu-')?7:profile==='6cpu-16g'?6:4,memoryBytes:profile==='8cpu-48g'?51539607552:profile==='7cpu-20g'?21474836480:profile.endsWith('-16g')?17179869184:4294967296};}
  const cpus=id.startsWith('social-')||id.endsWith('-4cpu-2g')?4:2;
  return {cpus,memoryBytes:cpus===4?2147483648:1073741824};
}

// Go's soft runtime limit leaves room below the unchanged 85% cgroup memory guard.
export function runnerGcEnvironment(profile, gc) {
  if(profile==='9cpu-48g'){assert.equal(gc,150);return {GOGC:'150',GOMEMLIMIT:'36GiB',GOMAXPROCS:'9'};}
  if(gc===undefined){assert.ok(!['7cpu-20g','8cpu-48g'].includes(profile),'Large heaps require explicit GC150');return {};}
  assert.ok(['7cpu-16g','7cpu-20g','8cpu-48g'].includes(profile));assert.equal(gc,150);
  return {GOGC:'150',GOMEMLIMIT:profile==='8cpu-48g'?'36GiB':profile==='7cpu-20g'?'15GiB':'12GiB'};
}

export function readCgroupSnapshot(directory='/sys/fs/cgroup', vmInfoPath) {
  return ['cpu.stat','memory.current','memory.peak','memory.events'].map(name=>`\n[${name}]\n${readFileSync(`${directory}/${name}`,'utf8')}`).join('')+(vmInfoPath?`\n[vm.meminfo]\n${readFileSync(vmInfoPath,'utf8')}`:'');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const[id,...args]=process.argv.slice(2);
  const profile=args[0]?.startsWith('--profile=')?args.shift().slice('--profile='.length):undefined;
  const gc=args[0]?.startsWith('--gc=')?Number(args.shift().slice('--gc='.length)):undefined;
  const workers=args[0]==='--workers=2'?2:1;if(workers===2)args.shift();
  assert.ok(workers===1||profile==='8cpu-48g'&&gc===150);
  const diagnosticProfile=args[0]==='--diagnostic-profile';if(diagnosticProfile)args.shift();
  assert.ok(!diagnosticProfile||workers===1&&profile==='8cpu-48g'&&gc===150);
  const prepared=args[0]==='--prepared-sessions';if(prepared)args.shift();
  const gcEnvironment=runnerGcEnvironment(profile,gc);if(gc!==undefined)assert.equal(prepared,true);
  assert.ok(workers===1||prepared);assert.ok(!diagnosticProfile||prepared);
  const budget=runnerBudget(id,profile);assert.equal(args[0],'run');
  if(prepared)assert.ok(['4cpu-16g','6cpu-16g','7cpu-16g','7cpu-20g','8cpu-48g','9cpu-48g'].includes(profile));
  const directory=`/results/${id}`,began=process.hrtime.bigint();
  if(gc!==undefined){
    for(const [key,value]of Object.entries(gcEnvironment))assert.equal(process.env[key],value,'Runner GC environment mismatch');
    writeFileSync(`${directory}/runner-gc.json`,JSON.stringify({profile,gc,environment:Object.fromEntries(Object.keys(gcEnvironment).map(key=>[key,process.env[key]])),childInheritsEnvironment:workers===1,...(workers===2?{workerEnvironment:{GOGC:'150',GOMEMLIMIT:'18GiB',GOMAXPROCS:'4'}}:{})}));
  }
  const limits=['cpu.max','memory.max','memory.swap.max'].map(name=>readFileSync(`/sys/fs/cgroup/${name}`,'utf8')).join('');
  writeFileSync(`${directory}/runner-limits.txt`,limits);
  const[quota,period,memory,swap]=limits.trim().split(/\s+/).map(Number);
  assert.equal(quota/period,budget.cpus);assert.equal(memory,budget.memoryBytes);assert.equal(swap,0);
  const sample=final=>appendFileSync(`${directory}/runner-cgroups.jsonl`,JSON.stringify({at:new Date().toISOString(),elapsedMs:Number(process.hrtime.bigint()-began)/1e6,source:readCgroupSnapshot('/sys/fs/cgroup',profile?'/proc/meminfo':undefined),final})+'\n');
  sample(false);
  // A same-cgroup supervisor survives k6 long enough to capture its final counters; no racing Docker exec.
  const timer=setInterval(()=>sample(false),1000);
  let gate,child,abortTimer,profiling;
  try {
    if(diagnosticProfile){
      assert.equal(process.env.GODEBUG,'gctrace=1');
      const config=JSON.parse(readFileSync('/config/run.json','utf8'));
      profiling=(await import('./runner-profiling.js')).startRunnerProfiling({directory,config});
      args.splice(1,0,'--profiling-enabled','--address','127.0.0.1:6565');
    }
    if(prepared){
      const {startPreparedGate}=await import('./prepared-gate.js');
      gate=await startPreparedGate({runId:id,config:JSON.parse(readFileSync('/config/run.json','utf8')),
        onEvent:row=>{appendFileSync(`${directory}/prepared-gate.jsonl`,JSON.stringify(row)+'\n');if(row.event==='released')profiling?.onRelease(row);},
        onFailure:()=>{abortTimer??=setTimeout(()=>child?.kill('SIGTERM'),1000);}});
    }
    const environment={...process.env,...(gate?{PREPARED_GATE_ORIGIN:gate.origin,PREPARED_RUN_ID:id}:{})};
    if(diagnosticProfile)writeFileSync(`${directory}/profiling/child-runtime.json`,JSON.stringify({launchAt:new Date().toISOString(),argv:args,environment:{GOGC:environment.GOGC,GOMEMLIMIT:environment.GOMEMLIMIT,GODEBUG:environment.GODEBUG},sharedRunnerCgroup:true}));
    child=workers===2?(await import('./segmented-workers.js')).startSegmentedWorkers(args,environment,directory):spawn('k6',args,{stdio:'inherit',env:environment});
    const handlers=Object.fromEntries(['SIGINT','SIGTERM'].map(signal=>[signal,()=>{gate?.fail('cancelled');child.kill(signal);}]));
    for(const[signal,handler]of Object.entries(handlers))process.on(signal,handler);
    let failed=false;child.once('error',()=>{failed=true;gate?.fail('child_exit');});
    const result=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    if(gate)writeFileSync(`${directory}/runner-child-exit.json`,JSON.stringify({...result,spawnFailed:failed||!!child.results?.some(r=>r.spawnFailed),...(workers===2?{aggregation:'any-worker-native-threshold-failure',workers:child.results}:{})}));
    if(gate){await gate.close(gate.snapshot().status==='preparing'?'child_exit':undefined);writeFileSync(`${directory}/prepared-gate.json`,JSON.stringify(gate.snapshot()));}
    for(const[signal,handler]of Object.entries(handlers))process.removeListener(signal,handler);
    process.exitCode=failed?1:(result.code??(128+(constants.signals[result.signal]??1)));
    if(gate?.snapshot().status==='failed'&&process.exitCode===0)process.exitCode=1;
  } finally {clearTimeout(abortTimer);clearInterval(timer);if(gate)await gate.close();try{if(profiling)await profiling.stop();}finally{sample(true);}}

}
