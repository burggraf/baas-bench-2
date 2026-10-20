import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { capture } from '../scripts/runtime.js';

for(const compareVus of [false,true])test(`SIGTERM during calibration ${compareVus?'128-VU comparison':'default'} removes the checked one-off runner before down, preserves invalid evidence and releases lock`, {timeout:60000}, async t=>{
  const child=spawn(process.execPath,['scripts/calibrate.js','--smoke',...(compareVus?['--compare-vus']:[])],{stdio:['ignore','pipe','pipe']});
  let text='';child.stdout.on('data',b=>{text+=b;});child.stderr.on('data',b=>{text+=b;});
  const exit=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const timer=setTimeout(()=>child.kill('SIGTERM'),45000);
  t.after(async()=>{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGTERM');await exit;});
  await new Promise((resolve,reject)=>{
    child.stdout.on('data',()=>{if((text.match(/scenarios:/g)?.length??0)>=(compareVus?2:1))resolve();});
    child.once('exit',()=>reject(new Error('Exited before scenario readiness')));
  });
  const op=JSON.parse(readFileSync('.fixtures/operation.lock')); assert.equal(op.command,'calibration');
  if(compareVus)assert.match(op.runnerName,/-vu128-runner$/);
  child.kill('SIGTERM');assert.equal((await exit).code,143,text);
  const report=JSON.parse(readFileSync(`results/${op.runId}/report.json`));assert.equal(report.valid,false);
  assert.equal(existsSync('.fixtures/operation.lock'),false);
  assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-calibration']),'');
  assert.equal(capture('docker',['network','ls','-q','--filter','label=com.docker.compose.project=baas-bench-2-calibration']),'');
});
