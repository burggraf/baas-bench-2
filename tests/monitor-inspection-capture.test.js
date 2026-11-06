import assert from 'node:assert/strict';
import test from 'node:test';
import {execute} from '../scripts/runtime.js';
import {captureInspection} from '../scripts/monitor.js';

const id='a'.repeat(64),state={id,status:'exited',running:false,exitCode:0};

test('inspection preserves malformed successful output and never retries it',async()=>{
  for(const stdout of ['not JSON','null','[]']){
    let calls=0;
    await assert.rejects(captureInspection(id,async()=>{calls++;return{stdout,stderr:'diagnostic\n'};},true),e=>{
      assert.equal(e.inspectionCapture.target,id);assert.equal(e.inspectionCapture.attempts.length,1);
      assert.equal(e.inspectionCapture.attempts[0].stdout,stdout);assert.equal(e.inspectionCapture.attempts[0].stderr,'diagnostic\n');
      assert.equal(e.inspectionCapture.attempts[0].exitCode,0);return true;
    });assert.equal(calls,1);
  }
});

test('missing or failed exact-ID inspections retain status without retrying',async()=>{
  const error=Object.assign(new Error('missing'),{code:1,killed:false,signal:null,stdout:'',stderr:'No such container: '+id+'\n'});let calls=0;
  await assert.rejects(captureInspection(id,async()=>{calls++;throw error;},true),e=>{
    assert.equal(e,error);assert.equal(e.inspectionCapture.attempts[0].exitCode,1);assert.equal(e.inspectionCapture.attempts[0].stderr,error.stderr);return true;
  });assert.equal(calls,1);
});

for(const recover of [true,false])test(`a real inspection timeout has one bounded recovery (${recover})`,{timeout:10000},async()=>{
  let calls=0;
  const docker=async(argv,timeout)=>{
    calls++;assert.equal(argv.at(-1),id);
    if(calls===2&&recover)return{stdout:JSON.stringify(state),stderr:''};
    return execute(process.execPath,['-e',"process.on('SIGTERM',()=>process.exit(0));process.stdout.write('partial inspector output');setInterval(()=>{},1000)"],{encoding:'utf8',timeout});
  };
  const began=performance.now();
  if(recover){
    const result=await captureInspection(id,docker,true);assert.deepEqual(result.state,state);
    assert.equal(result.capture.attempts.length,2);assert.equal(result.capture.attempts[0].killed,true);
    assert.equal(result.capture.attempts[0].exitCode,0);assert.equal(result.capture.attempts[0].stdout,'partial inspector output');
    assert.equal(result.capture.attempts[1].exitCode,0);
  }else await assert.rejects(captureInspection(id,docker,true),e=>{
    assert.equal(e.inspectionCapture.attempts.length,2);assert.ok(e.inspectionCapture.attempts.every(a=>a.killed));
    assert.ok(e.inspectionCapture.attempts[1].timeoutMs<=1000);return true;
  });
  assert.equal(calls,2);assert.ok(performance.now()-began<4500,'Retries must fit beneath the five-second coverage limit');
});

test('initial discovery and backend inspection keep the single-attempt policy',async()=>{
  let calls=0;
  await assert.rejects(captureInspection(id,async()=>{calls++;throw Object.assign(new Error('timeout'),{killed:true});}));
  assert.equal(calls,1);
});
