import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreparedClock, preparedSchedule} from '../src/workload.js';

function clock(samples) {
  const walls=samples.map(x=>x[1]),elapsed=samples.flatMap(x=>[x[0],x[2]]);
  return createPreparedClock(()=>walls.shift(),()=>elapsed.shift());
}
const epoch=1000000;
test('wide, bounded samples return fresh elapsed time instead of an old wall read',()=>{
  const now=clock([[0,epoch,0],[10,epoch+30,60],[70,epoch+90,120]]);
  assert.equal(now(),epoch+60);assert.equal(now(),epoch+120);
});
test('wide samples preserve a fixed anchor and reject forward/backward 101ms drift',()=>{
  for(const drift of [-101,101]){
    const now=clock([[0,epoch,0],...[10,70,130].map(t=>[t,epoch+t+20+drift,t+50])]);
    assert.throws(()=>now(),/prepared_clock_inconsistent/);
  }
});
test('uncertainty still consumes the 100ms bound',()=>{
  const now=clock([[0,epoch,0],...[10,80,150].map(t=>[t,epoch+t+115,t+60])]);
  assert.throws(()=>now(),/prepared_clock_inconsistent/);
});
test('a bounded retry recovers from an ambiguous sample without reanchoring',()=>{
  const now=clock([[0,epoch,0],[10,epoch+10,160],[170,epoch+190,220]]);
  assert.equal(now(),epoch+220);
});
test('fresh timestamps cross the original activation and phase boundaries',()=>{
  const c={vus:2,rampSeconds:30,warmupSeconds:60,measurementSeconds:120};
  const s=preparedSchedule(c,epoch,2);
  for(const boundary of [s.activationAt,s.measurementAt,s.endAt]){
    const t=boundary-epoch,now=clock([[0,epoch,0],[t-10,boundary-5,t+10]]);
    assert.equal(now(),boundary+10);
  }
});
test('small wall clock jitter does not move the fixed elapsed timeline',()=>{
  const now=clock([[0,epoch,0],[10,epoch+60,10],[20,epoch-30,20]]);
  assert.equal(now(),epoch+10);assert.equal(now(),epoch+20);
});
test('initial anchoring still requires a narrow sample',()=>{
  assert.throws(()=>clock([[0,epoch,2],[3,epoch+3,5],[6,epoch+6,8]]),/prepared_clock_inconsistent/);
});
