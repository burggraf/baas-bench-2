import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';
import{readCgroupSnapshot}from'../src/calibration-runner.js';
import{parseCgroup}from'../src/resources.js';
import{parseRunnerCgroups}from'../scripts/monitor.js';

test('self-cgroup ingestion requires final evidence, tolerates only live partial appends, and rejects bad/gapped/rewound samples',()=>{
  const row={at:'2026-10-20T00:00:00Z',elapsedMs:0,source:'snapshot',final:false};
  const line=JSON.stringify(row)+'\n';
  assert.equal(parseRunnerCgroups(line+'partial',0,-1,true).rows.length,1);
  assert.equal(parseRunnerCgroups(JSON.stringify({...row,final:true})+'\n',0,-1,false).rows[0].final,true);
  for(const[text,consumed,ms,running]of [[line,0,-1,false],[line+'partial',0,-1,false],['bad\n',0,-1,true],[line,2,-1,true],[line,0,100,true],[JSON.stringify({...row,elapsedMs:6000})+'\n',0,0,true],[JSON.stringify({...row,elapsedMs:-1})+'\n',0,-1,true]])assert.throws(()=>parseRunnerCgroups(text,consumed,ms,running));
});

test('same-cgroup telemetry reads original counters including final OOM evidence without Docker exec',t=>{
  const dir=mkdtempSync(`${tmpdir()}/calibration-cgroup-`);t.after(()=>rmSync(dir,{recursive:true}));
  for(const[name,text]of Object.entries({'cpu.stat':'usage_usec 123\nthrottled_usec 4\n','memory.current':'100\n','memory.peak':'200\n','memory.events':'oom 1\noom_kill 1\n'}))writeFileSync(`${dir}/${name}`,text);
  const parsed=parseCgroup(readCgroupSnapshot(dir));
  assert.equal(parsed.cpuStat.usage_usec,123);assert.equal(parsed.memoryEvents.oom_kill,1);assert.equal(parsed.memoryCurrentBytes,100);
  writeFileSync(`${dir}/memory.events`,'oom 2\noom_kill 2\n');assert.equal(parseCgroup(readCgroupSnapshot(dir)).memoryEvents.oom_kill,2);
});
test('same-cgroup reader does not invent missing counters',()=>{assert.throws(()=>readCgroupSnapshot('/definitely-missing-calibration-cgroup'));});
