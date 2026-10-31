import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as workload from '../src/workload.js';

// Exercise the real VU clock and initialization, with deterministic reader scheduling.
const source=readFileSync(new URL('../src/k6/social.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('let done = false, applicationStart = null;'),source.indexOf('\nconst phase ='));
const start=source.indexOf('// Initialization is outside the execution clock.');
const initialization=source.slice(start,source.indexOf('  const now = clockNow;',start));
assert.ok(block.includes('const clockNow')&&initialization.includes('Initialization'));
function harness(prepared=true){
  let elapsed=0,wallOffset=0,monoOffset=0,pending=0,pauseNext=0,pauseEvery=0,wallReads=0;
  const date={now(){wallReads++;const value=1000000+elapsed+wallOffset;pending=pauseNext||pauseEvery;pauseNext=0;return value;}};
  const evidence=[];
  const exec={instance:{get currentTestRunDuration(){elapsed+=pending;pending=0;return elapsed+monoOffset;}},vu:{idInTest:1},test:{abort(reason){throw new Error(reason);}}};
  const clock=new Function('Date','exec','prepared','createPreparedClock','console',block+'\nreturn {initialize(){'+initialization+'},read:clockNow};')(date,exec,prepared,workload.createPreparedClock,{error:message=>evidence.push(JSON.parse(message))});
  return {...clock,evidence,advance:n=>{elapsed+=n;},jumpWall:n=>{wallOffset=n;},jumpMono:n=>{monoOffset=n;},pauseOnce:n=>{pauseNext=n;},pauseAlways:n=>{pauseEvery=n;},wallReads:()=>wallReads};
}

test('consistent clocks survive a scheduling pause between wall and elapsed reads',()=>{
  const c=harness();c.initialize();c.advance(10);c.pauseOnce(150);
  assert.doesNotThrow(()=>c.read());
});
test('consistent clocks survive a scheduling pause during anchor initialization',()=>{
  const c=harness();c.pauseOnce(150);assert.doesNotThrow(()=>c.initialize());assert.doesNotThrow(()=>c.read());
});
test('a long pause between complete samples is not clock drift',()=>{
  const c=harness();c.initialize();c.advance(300000);assert.equal(c.read(),1300000);
});
test('unchanged 100ms boundary passes but forward/backward drift above it fails',()=>{
  for(const offset of [-100,100]){const c=harness();c.initialize();c.jumpWall(offset);assert.doesNotThrow(()=>c.read());}
  for(const offset of [-101,101]){const c=harness();c.initialize();c.jumpWall(offset);assert.throws(()=>c.read(),/prepared_clock_inconsistent/);}
});
test('resampling a delayed read never reanchors or hides real clock drift',()=>{
  for(const offset of [-101,101]){const c=harness();c.initialize();c.jumpWall(offset);c.pauseOnce(150);assert.throws(()=>c.read(),/prepared_clock_inconsistent/);}
});
test('persistent ambiguous sampling fails closed after bounded work',()=>{
  const c=harness();c.initialize();const before=c.wallReads();c.pauseAlways(150);assert.throws(()=>c.read(),/prepared_clock_inconsistent/);assert.ok(c.wallReads()-before<=3);
});
test('nonfinite clock input fails closed instead of bypassing comparison',()=>{
  for(const offset of [NaN,Infinity,-Infinity]){const c=harness();c.initialize();c.jumpWall(offset);assert.throws(()=>c.read(),/prepared_clock_inconsistent/);}
});
test('sample uncertainty consumes rather than expands the 100ms policy',()=>{
  assert.equal(typeof workload.createPreparedClock,'function');
  for(const [wall,allowed]of [[1000109,true],[1000110,false]]){
    const walls=[1000000,wall],monos=[0,1,10,11];
    const now=workload.createPreparedClock(()=>walls.shift(),()=>monos.shift());
    if(allowed)assert.doesNotThrow(()=>now());else assert.throws(()=>now(),/prepared_clock_inconsistent/);
  }
});
test('backwards elapsed clock fails closed',()=>{
  const c=harness();c.initialize();c.jumpMono(-1);assert.throws(()=>c.read(),/prepared_clock_inconsistent/);
});
test('legacy wall clock behavior remains unguarded',()=>{
  const c=harness(false);c.initialize();c.jumpWall(10000);assert.equal(c.read(),1010000);
});
