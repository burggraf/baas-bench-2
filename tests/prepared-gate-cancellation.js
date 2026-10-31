import assert from'node:assert/strict';import{constants}from'node:os';
export function assertPreparedCancellation({mode,signalled,code,childExit,gate,rows,business}){
  assert.ok(['sigint','sigterm'].includes(mode));assert.equal(signalled,true);assert.equal(childExit.spawnFailed,false);
  const signal=mode.toUpperCase(),nativeAbort=childExit.signal===null&&[105,108].includes(childExit.code)&&code===childExit.code;
  const nativeSignal=childExit.code===null&&childExit.signal===signal&&code===128+constants.signals[signal];
  assert.ok(nativeAbort||nativeSignal,'Require the actual requested signal or exact native abort code');
  assert.equal(gate.status,'failed');assert.equal(gate.reason,'cancelled');assert.equal(gate.releaseAt,null);assert.equal(rows.some(r=>r.event==='released'),false);if(business)assert.equal(business.length,0);
}
