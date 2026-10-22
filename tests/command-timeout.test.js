import assert from 'node:assert/strict';
import test from 'node:test';
import {execute} from '../scripts/runtime.js';

test('completed commands retain exact stdout and stderr',async()=>{
  const result=await execute(process.execPath,['-e',"process.stdout.write('output\\n');process.stderr.write('diagnostic\\n')"],{encoding:'utf8',timeout:1000});
  assert.deepEqual(result,{stdout:'output\n',stderr:'diagnostic\n'});
});

test('a deadline remains failure when the terminated client handles SIGTERM and exits zero', {timeout:5000},async()=>{
  await assert.rejects(execute(process.execPath,['-e',"process.on('SIGTERM',()=>process.exit(0));process.stdout.write('[cpu.stat]\\n');process.stderr.write('partial diagnostic\\n');setInterval(()=>{},1000)"],{encoding:'utf8',timeout:1000}),error=>{
    assert.equal(error.code,'ERR_CHILD_PROCESS_KILLED');assert.equal(error.killed,true);assert.equal(error.exitCode,0);
    assert.equal(error.signal,null);assert.equal(error.stdout,'[cpu.stat]\n');assert.equal(error.stderr,'partial diagnostic\n');assert.equal(error.timeoutMs,1000);return true;
  });
});

test('ordinary nonzero command errors retain their original status and streams',async()=>{
  await assert.rejects(execute(process.execPath,['-e',"process.stdout.write('partial\\n');process.stderr.write('failed\\n');process.exit(7)"],{encoding:'utf8',timeout:1000}),error=>{
    assert.equal(error.code,7);assert.equal(error.killed,false);assert.equal(error.stdout,'partial\n');assert.equal(error.stderr,'failed\n');return true;
  });
});
