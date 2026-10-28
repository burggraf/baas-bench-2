import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import * as monitor from '../scripts/monitor.js';
import { campaignResourceStop } from '../src/campaign.js';

const id='a'.repeat(64),state={id,pid:123},group=`/system.slice/docker-${id}.scope`;
const files={'cpu.stat':'usage_usec 1\nthrottled_usec 0\n','memory.current':'1024\n','memory.peak':'2048\n','memory.events':'max 0\noom 0\noom_kill 0\n'};
const mockReads=(t,override={})=>{
  const calls=[];t.mock.method(fs,'readFile',async(path,options)=>{
    calls.push(path);assert.equal(options.encoding,'utf8');assert.ok(options.signal instanceof AbortSignal);
    if(Object.hasOwn(override,path)){const value=override[path];if(value instanceof Error)throw value;return typeof value==='function'?value():value;}
    if(path===`/proc/${state.pid}/cgroup`)return `0::${group}\n`;
    const name=Object.keys(files).find(name=>path===`/sys/fs/cgroup${group}/${name}`);assert.ok(name,`Unexpected path ${path}`);return files[name];
  });return calls;
};

test('host cgroup capture binds the Docker PID to its full ID and retains unchanged native counter text',async t=>{
  assert.equal(typeof monitor.captureHostCgroups,'function');const calls=mockReads(t);
  const result=await monitor.captureHostCgroups(state);
  assert.equal(result.source,Object.entries(files).map(([name,body])=>`\n[${name}]\n${body}`).join(''));
  assert.equal(result.capture.method,'host-cgroup-v2');assert.equal(result.capture.containerId,id);assert.equal(result.capture.pid,state.pid);assert.equal(result.capture.path,`/sys/fs/cgroup${group}`);assert.equal(result.capture.timeoutMs,2000);assert.equal(result.capture.stdoutBytes,Buffer.byteLength(result.source));assert.equal(result.capture.clientExitCode,undefined);
  assert.equal(calls.filter(p=>p.startsWith('/proc/')).length,2);assert.equal(campaignResourceStop({type:'cgroup',role:'backend',source:result.source}),null);
});

for(const membership of [`0::/system.slice/docker-${'b'.repeat(64)}.scope\n`,`0::/system.slice/../docker-${id}.scope\n`,`0::/docker/${id}/../../etc\n`,`0::${group}/nested\n`,`0::/system.slice/docker-${id}Xscope\n`,'0::/\n',`1:cpu:/docker/${id}\n`,`0::${group}\n0::${group}\n`])test(`host cgroups refuse foreign, escaped or non-unified membership ${JSON.stringify(membership)}`,async t=>{
  assert.equal(typeof monitor.captureHostCgroups,'function');const calls=mockReads(t,{[`/proc/${state.pid}/cgroup`]:membership});await assert.rejects(monitor.captureHostCgroups(state));assert.equal(calls.some(p=>p.startsWith('/sys/')),false);
});

test('host cgroup capture rejects invalid identity before filesystem access',async t=>{
  assert.equal(typeof monitor.captureHostCgroups,'function');const calls=mockReads(t);for(const changed of [{id:'../bad'},{pid:0},{pid:-1},{pid:1.1},{pid:undefined}])await assert.rejects(monitor.captureHostCgroups({...state,...changed}));assert.equal(calls.length,0);
});

test('host cgroup capture rejects PID migration/reuse and does not retry failed reads',async t=>{
  assert.equal(typeof monitor.captureHostCgroups,'function');let memberships=0;const calls=mockReads(t,{[`/proc/${state.pid}/cgroup`]:()=>++memberships===1?`0::${group}\n`:'0::/different\n'});
  await assert.rejects(monitor.captureHostCgroups(state));assert.equal(calls.length,6);
});

test('host cgroup capture retains partial raw evidence and original filesystem error without retry',async t=>{
  assert.equal(typeof monitor.captureHostCgroups,'function');const error=Object.assign(new Error('denied'),{code:'EACCES'}),path=`/sys/fs/cgroup${group}/memory.events`,calls=mockReads(t,{[path]:error});
  await assert.rejects(monitor.captureHostCgroups(state),e=>{assert.equal(e,error);assert.equal(e.cgroupCapture.method,'host-cgroup-v2');assert.ok(e.cgroupCapture.stdout.includes('[memory.peak]'));assert.equal(e.cgroupCapture.errorCode,'EACCES');return true;});assert.equal(calls.filter(p=>p===path).length,1);
});

test('host native reads share a single unchanged two-second abort deadline',async t=>{
  assert.equal(typeof monitor.captureHostCgroups,'function');let signal;
  const keepAlive=setTimeout(()=>{},4000);t.after(()=>clearTimeout(keepAlive));
  t.mock.method(fs,'readFile',async(path,options)=>{
    signal??=options.signal;assert.equal(options.signal,signal);
    if(path.startsWith('/proc/'))return `0::${group}\n`;
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });
  await assert.rejects(monitor.captureHostCgroups(state),e=>{assert.equal(e.name,'TimeoutError');assert.equal(e.cgroupCapture.timeoutMs,2000);return true;});
});
