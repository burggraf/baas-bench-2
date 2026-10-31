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
