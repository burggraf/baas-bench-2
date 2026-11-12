import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {once} from 'node:events';
import {EventEmitter} from 'node:events';
import http from 'node:http';

const base=JSON.parse(readFileSync('configs/smoke.json'));
const config=(patch={})=>({...base,version:'social-prepared-v1',authPreparation:{loginsPerSecond:20,timeoutSeconds:2},...patch});
async function gate(t,patch={}){
  assert.ok(existsSync('src/prepared-gate.js'),'A real bounded readiness gate must exist');
  const {startPreparedGate}=await import('../src/prepared-gate.js');
  const rows=[], events=new EventEmitter();
  const g=await startPreparedGate({runId:'social-Abc123',config:config(patch),onEvent:row=>{rows.push(row);events.emit(row.event,row);}});
  t.after(()=>g.close());
  const post=async(route,value)=>{
    const response=await fetch(g.origin+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId:'social-Abc123',...value}),signal:AbortSignal.timeout(5000)});
    return {status:response.status,body:await response.json()};
  };
  const ready=ordinal=>post('/ready',{ordinal,loginAtMs:Date.now(),expiresAtMs:Date.now()+3600000,ttlSeconds:3600});
  return {g,rows,events,post,ready};
}

test('gate serializes paced admission and releases exactly all distinct ready users to one epoch',async t=>{
  const {g,rows,events,post,ready}=await gate(t);
  const admitted2=post('/admit',{ordinal:2});assert.equal((await admitted2).status,200);
  let admitted1=false;const pending=post('/admit',{ordinal:1}).then(r=>{admitted1=true;return r;});
  const received=once(events,'ready');const held=ready(2);await received;
  assert.equal((await pending).status,200);assert.equal(admitted1,true);
  assert.equal(rows.some(r=>r.event==='released'),false);
  const second=await ready(1),first=await held;
  assert.equal(second.status,200);assert.deepEqual(second.body,first.body);
  assert.equal(second.body.releaseAt,rows.find(r=>r.event==='released').releaseAt);
  const admissions=rows.filter(r=>r.event==='admitted');assert.ok(admissions[1].elapsedMs-admissions[0].elapsedMs>=49);
  assert.equal(g.snapshot().readyUsers,2);assert.equal(g.snapshot().status,'released');
  assert.equal(rows.filter(r=>r.event==='ready').length,2);
});

for(const [name,route,value] of [
  ['duplicate','/admit',{ordinal:1}],['foreign run','/ready',{ordinal:1,runId:'social-Foreig'}],
  ['out of range','/admit',{ordinal:3}],['extra fields','/ready',{ordinal:1,password:'not-a-real-password'}],
  ['unadmitted readiness','/ready',{ordinal:2,loginAtMs:1,expiresAtMs:2,ttlSeconds:1}],
  ['unexpected route','/other',{ordinal:1}],
])test(`gate fails closed on ${name} without another permit`,async t=>{
  const {g,post}=await gate(t);await post('/admit',{ordinal:1});
  const result=await post(route,value);assert.notEqual(result.status,200);
  assert.equal(g.snapshot().status,'failed');assert.equal(g.snapshot().admittedUsers,1);
});

test('a missing user hits the finite deadline and rejects held readiness without release',async t=>{
  const {g,post,ready,rows}=await gate(t,{authPreparation:{loginsPerSecond:20,timeoutSeconds:0.15}});
  await post('/admit',{ordinal:1});assert.equal((await ready(1)).status,503);
  assert.equal(g.snapshot().reason,'deadline');assert.equal(rows.some(r=>r.event==='released'),false);
});

test('insufficient native token lifetime cannot pass the all-ready barrier',async t=>{
  const {g,post,ready}=await gate(t);await post('/admit',{ordinal:1});
  const held=post('/ready',{ordinal:1,loginAtMs:Date.now(),expiresAtMs:Date.now()+500,ttlSeconds:1});
  await post('/admit',{ordinal:2});assert.equal((await ready(2)).status,503);assert.equal((await held).status,503);
  assert.equal(g.snapshot().reason,'token_lifetime');
});

test('known native expiry remains usable when an SDK token omits issued-at/TTL',async t=>{
  const {g,post,ready}=await gate(t);await post('/admit',{ordinal:1});
  const held=post('/ready',{ordinal:1,loginAtMs:Date.now(),expiresAtMs:Date.now()+3600000,ttlSeconds:null});
  await post('/admit',{ordinal:2});assert.equal((await ready(2)).status,200);assert.equal((await held).status,200);assert.equal(g.snapshot().status,'released');
});

test('cancellation rejects pending admissions and closes only the owned gate',async t=>{
  const {g,post,events}=await gate(t);await post('/admit',{ordinal:1});
  const queued=once(events,'queued');const pending=post('/admit',{ordinal:2});await queued;
  await g.close('cancelled');assert.equal((await pending).status,503);assert.equal(g.snapshot().reason,'cancelled');
});

test('slow preparation never issues overlapping permits or catches up missed rate slots',async t=>{
  const {g,rows,post,ready}=await gate(t,{vus:3});await post('/admit',{ordinal:1});
  const second=post('/admit',{ordinal:2}),third=post('/admit',{ordinal:3});
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(g.snapshot().admittedUsers,1);
  const firstReady=ready(1);assert.equal((await second).status,200);const secondReady=ready(2);assert.equal((await third).status,200);
  await ready(3);await firstReady;await secondReady;
  const admissions=rows.filter(r=>r.event==='admitted');assert.ok(admissions[1].elapsedMs-admissions[0].elapsedMs>=150);assert.ok(admissions[2].elapsedMs-admissions[1].elapsedMs>=49);
});
for(const mode of ['oversized','method','expiry-string','bad-ttl','negative-login','failure-reason'])test(`gate validates ${mode} at its boundary`,async t=>{
  const {g,post}=await gate(t);await post('/admit',{ordinal:1});
  const value={runId:'social-Abc123',ordinal:1,loginAtMs:Date.now(),expiresAtMs:Date.now()+3600000,ttlSeconds:3600};
  let route='/ready',method='POST';
  if(mode==='oversized')value.extra='x'.repeat(513);
  if(mode==='method')method='GET';
  if(mode==='expiry-string')value.expiresAtMs=String(value.expiresAtMs);
  if(mode==='bad-ttl')value.ttlSeconds=0;
  if(mode==='negative-login')value.loginAtMs=-1;
  if(mode==='failure-reason'){route='/failed';delete value.loginAtMs;delete value.expiresAtMs;delete value.ttlSeconds;value.reason='private SDK response';}
  const response=await fetch(g.origin+route,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(value)}:{})});
  assert.notEqual(response.status,200);assert.equal(g.snapshot().status,'failed');assert.equal(g.snapshot().admittedUsers,1);
});
test('a wall-clock jump fails preparation instead of shifting the measured clock',async t=>{
  const {g,post}=await gate(t),original=Date.now;
  try{Date.now=()=>original()+1000;assert.equal((await post('/admit',{ordinal:1})).status,503);assert.equal(g.snapshot().reason,'clock_inconsistent');}
  finally{Date.now=original;}
});
test('preparation elapsed time freezes at release and the loopback listener closes',async t=>{
  const {g,post,ready}=await gate(t);await post('/admit',{ordinal:1});const held=ready(1);await post('/admit',{ordinal:2});await ready(2);await held;await g.close();
  const elapsed=g.snapshot().elapsedMs;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(g.snapshot().elapsedMs,elapsed);
  await assert.rejects(fetch(g.origin+'/admit',{method:'POST'}));
});

test('lost readiness waiter fails preparation and never advances the queue',async t=>{
  const {g,post,events}=await gate(t);await post('/admit',{ordinal:1});
  const readyEvent=once(events,'ready'),failure=once(events,'failed');
  const req=http.request(g.origin+'/ready',{method:'POST',headers:{'content-type':'application/json'}});req.on('error',()=>{});
  req.end(JSON.stringify({runId:'social-Abc123',ordinal:1,loginAtMs:Date.now(),expiresAtMs:Date.now()+3600000,ttlSeconds:3600}));
  await readyEvent;req.destroy();await failure;assert.equal(g.snapshot().reason,'participant_disconnect');
});

test('gate event timestamps stay coherent when execution advances between clock reads',async t=>{
  const {performance}=await import('node:perf_hooks');
  const {startPreparedGate}=await import('../src/prepared-gate.js');
  const original=performance.now.bind(performance),rows=[];let reads=0;
  // Model the recorded 12.19-ms interruption, without blocking the test host.
  // Before the fix, it splits the started event's two clock samples.
  t.mock.method(performance,'now',()=>original()+(++reads>=3?12.19:0));
  const g=await startPreparedGate({runId:'social-Abc123',config:config(),onEvent:row=>rows.push(row)});
  try{await g.close('cancelled');}
  finally{await g.close();}
  assert.deepEqual(rows.map(r=>r.event),['started','failed','closed']);
  assert.ok(rows.some(r=>r.elapsedMs>=12.19),'The simulated interruption must have occurred');
  const first=rows[0];
  for(const row of rows){
    const mismatch=(row.at-first.at)-(row.elapsedMs-first.elapsedMs);
    assert.ok(Math.abs(mismatch)<0.001,`Event ${row.event} has a ${mismatch}-ms clock-pair mismatch`);
  }
});

test('admission spacing remains bounded after a pause between the pacing decision and permit emission',async t=>{
  const {performance}=await import('node:perf_hooks');
  const {rows,post,ready}=await gate(t);
  const original=performance.now.bind(performance);let pumpReads=0,paused=false;
  const sleeper=new Int32Array(new SharedArrayBuffer(4));
  t.mock.method(performance,'now',()=>{
    const sampled=original();
    // A scheduling pause after the pacing decision formerly separated its
    // private admission timestamp from the recorded permit by 10 ms. Reproduce
    // that interruption at the fourth gate-pump clock read, without changing
    // either clock or weakening the recorded spacing requirement.
    if(!paused&&new Error().stack.includes('at pump ')&&++pumpReads===4){paused=true;Atomics.wait(sleeper,0,0,25);}
    return sampled;
  });
  await post('/admit',{ordinal:1});
  const next=post('/admit',{ordinal:2}),held=ready(1);
  assert.equal((await next).status,200);assert.equal((await ready(2)).status,200);assert.equal((await held).status,200);
  assert.equal(paused,true,'The interruption must occur during the admission decision');
  const permits=rows.filter(row=>row.event==='admitted');assert.equal(permits.length,2);
  assert.ok(permits[1].elapsedMs-permits[0].elapsedMs>=49,'Permits must retain the original 20/s test rate even after the pause');
});
