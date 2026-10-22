import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as monitor from '../scripts/monitor.js';
import {campaignResourceStop} from '../src/campaign.js';

for(const stdout of ['\n[cpu.stat]\nusage_usec 1\n',''])test(`cgroup capture retains successful Docker-client stderr and metadata (${stdout?'output':'empty output'})`,async()=>{
  assert.equal(typeof monitor.captureCgroups,'function','Missing command diagnostics capture');
  const id='a'.repeat(64),stderr='native command diagnostic\n';
  const result=await monitor.captureCgroups(id,async argv=>{assert.deepEqual(argv.slice(0,4),['exec',id,'sh','-c']);assert.ok(argv[4].includes('memory.events'));return{stdout,stderr};});
  assert.equal(result.source,stdout);assert.equal(result.capture.stderr,stderr);assert.equal(result.capture.clientExitCode,0);
  assert.equal(result.capture.stdoutBytes,Buffer.byteLength(stdout));assert.deepEqual(result.capture.argv.slice(0,4),['exec',id,'sh','-c']);
  assert.ok(Number.isFinite(Date.parse(result.capture.startedAt)));assert.ok(Number.isFinite(result.capture.durationMs)&&result.capture.durationMs>=0);
  if(!stdout)assert.equal(campaignResourceStop({type:'cgroup',role:'backend',source:result.source,capture:result.capture}), 'invalid_telemetry','A successful CLI exit must not make an empty sample valid');
});

test('cgroup capture retains failed command partial streams and signal without retrying or replacing the original error',async()=>{
  assert.equal(typeof monitor.captureCgroups,'function','Missing command diagnostics capture');
  const error=Object.assign(new Error('command failed'),{stdout:'partial native counters',stderr:'native failure\n',code:null,killed:true,signal:'SIGTERM'});let calls=0;
  await assert.rejects(monitor.captureCgroups('b'.repeat(64),async()=>{calls++;throw error;}),failure=>{
    assert.equal(failure,error);assert.equal(failure.cgroupCapture.stdout,error.stdout);assert.equal(failure.cgroupCapture.stderr,error.stderr);
    assert.equal(failure.cgroupCapture.clientExitCode,null);assert.equal(failure.cgroupCapture.killed,true);assert.equal(failure.cgroupCapture.signal,'SIGTERM');assert.ok(failure.cgroupCapture.durationMs>=0);return true;
  });assert.equal(calls,1);
});

test('native cgroup reads need no external processes inside the CPU-limited backend',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'cgroup-builtins-')),files={'cpu.stat':'usage_usec 1\n','memory.current':'1024\n','memory.peak':'2048\n','memory.events':'max 0\noom 0\noom_kill 0\n'};
  try{
    for(const[name,body]of Object.entries(files))writeFileSync(join(directory,name),body);
    const docker=argv=>promisify(execFile)('/bin/sh',['-c',argv[4].replaceAll('/sys/fs/cgroup/',`${directory}/`)],{encoding:'utf8',env:{PATH:''},timeout:1000});
    const result=await monitor.captureCgroups('c'.repeat(64),docker);
    assert.equal(result.source,Object.entries(files).map(([name,body])=>`\n[${name}]\n${body}`).join(''));
    unlinkSync(join(directory,'memory.events'));
    const missing=await monitor.captureCgroups('c'.repeat(64),docker);
    assert.ok(missing.source.includes('[memory.events]\nunavailable\n'));assert.equal(campaignResourceStop({type:'cgroup',role:'backend',source:missing.source}),'invalid_telemetry');
  }finally{rmSync(directory,{recursive:true});}
});
