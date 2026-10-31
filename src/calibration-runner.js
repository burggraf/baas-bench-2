import assert from 'node:assert/strict';
import {spawn}from'node:child_process';
import{readFileSync,appendFileSync,writeFileSync}from'node:fs';
import{constants}from'node:os';
import{fileURLToPath}from'node:url';

export function runnerBudget(id, profile) {
  assert.match(id,/^(social-[A-Za-z0-9]{6}|calibration-[A-Za-z0-9]{6}-(10|25|40|100|400|1600)(-vu(32|128)|-vu128-(2cpu-1g|4cpu-2g))?)$/);
  if(profile!==undefined){assert.ok(['4cpu-4g','4cpu-16g'].includes(profile));assert.match(id,/^social-[A-Za-z0-9]{6}$/);return {cpus:4,memoryBytes:profile==='4cpu-16g'?17179869184:4294967296};}
  const cpus=id.startsWith('social-')||id.endsWith('-4cpu-2g')?4:2;
  return {cpus,memoryBytes:cpus===4?2147483648:1073741824};
}

export function readCgroupSnapshot(directory='/sys/fs/cgroup', vmInfoPath) {
  return ['cpu.stat','memory.current','memory.peak','memory.events'].map(name=>`\n[${name}]\n${readFileSync(`${directory}/${name}`,'utf8')}`).join('')+(vmInfoPath?`\n[vm.meminfo]\n${readFileSync(vmInfoPath,'utf8')}`:'');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const[id,...args]=process.argv.slice(2);
  const profile=args[0]?.startsWith('--profile=')?args.shift().slice('--profile='.length):undefined;
  const prepared=args[0]==='--prepared-sessions';if(prepared)args.shift();
  const budget=runnerBudget(id,profile);assert.equal(args[0],'run');
  if(prepared)assert.equal(profile,'4cpu-16g');
  const directory=`/results/${id}`,began=process.hrtime.bigint();
  const limits=['cpu.max','memory.max','memory.swap.max'].map(name=>readFileSync(`/sys/fs/cgroup/${name}`,'utf8')).join('');
  writeFileSync(`${directory}/runner-limits.txt`,limits);
  const[quota,period,memory,swap]=limits.trim().split(/\s+/).map(Number);
  assert.equal(quota/period,budget.cpus);assert.equal(memory,budget.memoryBytes);assert.equal(swap,0);
  const sample=final=>appendFileSync(`${directory}/runner-cgroups.jsonl`,JSON.stringify({at:new Date().toISOString(),elapsedMs:Number(process.hrtime.bigint()-began)/1e6,source:readCgroupSnapshot('/sys/fs/cgroup',profile?'/proc/meminfo':undefined),final})+'\n');
  sample(false);
  // A same-cgroup supervisor survives k6 long enough to capture its final counters; no racing Docker exec.
  const timer=setInterval(()=>sample(false),1000);
  let gate,child,abortTimer;
  try {
    if(prepared){
      const {startPreparedGate}=await import('./prepared-gate.js');
      gate=await startPreparedGate({runId:id,config:JSON.parse(readFileSync('/config/run.json','utf8')),
        onEvent:row=>appendFileSync(`${directory}/prepared-gate.jsonl`,JSON.stringify(row)+'\n'),
        onFailure:()=>{abortTimer??=setTimeout(()=>child?.kill('SIGTERM'),1000);}});
    }
    child=spawn('k6',args,{stdio:'inherit',env:{...process.env,...(gate?{PREPARED_GATE_ORIGIN:gate.origin,PREPARED_RUN_ID:id}:{})}});
    const handlers=Object.fromEntries(['SIGINT','SIGTERM'].map(signal=>[signal,()=>{gate?.fail('cancelled');child.kill(signal);}]));
    for(const[signal,handler]of Object.entries(handlers))process.on(signal,handler);
    let failed=false;child.once('error',()=>{failed=true;gate?.fail('child_exit');});
    const result=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    if(gate)writeFileSync(`${directory}/runner-child-exit.json`,JSON.stringify({...result,spawnFailed:failed}));
    if(gate){await gate.close(gate.snapshot().status==='preparing'?'child_exit':undefined);writeFileSync(`${directory}/prepared-gate.json`,JSON.stringify(gate.snapshot()));}
    for(const[signal,handler]of Object.entries(handlers))process.removeListener(signal,handler);
    process.exitCode=failed?1:(result.code??(128+(constants.signals[result.signal]??1)));
    if(gate?.snapshot().status==='failed'&&process.exitCode===0)process.exitCode=1;
  } finally {clearTimeout(abortTimer);clearInterval(timer);if(gate)await gate.close();sample(true);}

}
