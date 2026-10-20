import assert from 'node:assert/strict';
import {spawn}from'node:child_process';
import{readFileSync,appendFileSync,writeFileSync}from'node:fs';
import{constants}from'node:os';
import{fileURLToPath}from'node:url';

export function readCgroupSnapshot(directory='/sys/fs/cgroup') {
  return ['cpu.stat','memory.current','memory.peak','memory.events'].map(name=>`\n[${name}]\n${readFileSync(`${directory}/${name}`,'utf8')}`).join('');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const[id,...args]=process.argv.slice(2);
  assert.match(id,/^calibration-[A-Za-z0-9]{6}-(10|25|40|100|400|1600)(-vu(32|128))?$/);assert.equal(args[0],'run');
  const directory=`/results/${id}`,began=process.hrtime.bigint();
  const limits=['cpu.max','memory.max','memory.swap.max'].map(name=>readFileSync(`/sys/fs/cgroup/${name}`,'utf8')).join('');
  writeFileSync(`${directory}/runner-limits.txt`,limits);
  const[quota,period,memory,swap]=limits.trim().split(/\s+/).map(Number);
  assert.equal(quota/period,2);assert.equal(memory,1073741824);assert.equal(swap,0);
  const sample=final=>appendFileSync(`${directory}/runner-cgroups.jsonl`,JSON.stringify({at:new Date().toISOString(),elapsedMs:Number(process.hrtime.bigint()-began)/1e6,source:readCgroupSnapshot(),final})+'\n');
  sample(false);
  // A same-cgroup supervisor survives k6 long enough to capture its final counters; no racing Docker exec.
  const timer=setInterval(()=>sample(false),1000),child=spawn('k6',args,{stdio:'inherit'});
  const handlers=Object.fromEntries(['SIGINT','SIGTERM'].map(signal=>[signal,()=>child.kill(signal)]));
  for(const[signal,handler]of Object.entries(handlers))process.on(signal,handler);
  let failed=false;child.once('error',()=>{failed=true;});
  child.once('close',(code,signal)=>{
    clearInterval(timer);sample(true);
    for(const[signal,handler]of Object.entries(handlers))process.removeListener(signal,handler);
    process.exitCode=failed?1:(code??(128+(constants.signals[signal]??1)));
  });
}
