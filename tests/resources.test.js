import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeResources, parseCgroup } from '../src/resources.js';
import { isTerminalSamplingRace, parseStatsLine } from '../scripts/monitor.js';

test('runner exit between inspection and cgroup read is a verified transition, not a collector failure', () => {
  const id = 'a'.repeat(64), state = { id, status: 'exited', running: false, exitCode: 0 };
  const error = { code: 1, stderr: `Error response from daemon: container ${id} is not running\n` };
  assert.equal(isTerminalSamplingRace('runner', state, error), true);
  assert.equal(isTerminalSamplingRace('backend', state, error), false);
  assert.equal(isTerminalSamplingRace('runner', { ...state, running: true }, error), false);
  assert.equal(isTerminalSamplingRace('runner', { ...state, status: 'dead' }, error), false);
  assert.equal(isTerminalSamplingRace('runner', state, { ...error, stderr: 'permission denied' }), false);
  assert.equal(isTerminalSamplingRace('runner', state, { ...error, code: 'ETIMEDOUT' }), false);
  assert.equal(isTerminalSamplingRace('runner', { ...state, id: 'b'.repeat(64) }, error), false);
  // An actual crash remains a bad runner exit in summarizeResources, independently of this race.
  assert.equal(isTerminalSamplingRace('runner', { ...state, exitCode: 137 }, error), true);
});

test('Docker-killed in-flight exec is a terminal race only for its exact cleanly exited runner, never timeout/OOM/backend', () => {
  const id='a'.repeat(64),state={id,status:'exited',running:false,exitCode:0,oomKilled:false};
  const error={code:137,stderr:'',killed:false,signal:null,cgroupCapture:{argv:['exec',id,'sh','-c','read counters']}};
  assert.equal(isTerminalSamplingRace('runner',state,error),true);
  assert.equal(isTerminalSamplingRace('runner',{...state,exitCode:99},error),true);
  for(const patch of [{running:true},{status:'dead'},{oomKilled:true},{exitCode:137},{id:'b'.repeat(64)}])assert.equal(isTerminalSamplingRace('runner',{...state,...patch},error),false);
  for(const patch of [{code:1},{killed:true},{signal:'SIGTERM'},{stderr:'permission denied'},{cgroupCapture:undefined}])assert.equal(isTerminalSamplingRace('runner',state,{...error,...patch}),false);
  assert.equal(isTerminalSamplingRace('backend',state,error),false);
});

test('Docker removed-exec race requires exact not-running stdout, native exec error and verified clean runner', () => {
  const id='a'.repeat(64),state={id,status:'exited',running:false,exitCode:0,oomKilled:false};
  const error={code:1,stdout:`container ${id} is not running\r\n`,stderr:`Error response from daemon: No such exec instance: ${'b'.repeat(64)}\n`,killed:false,signal:null,cgroupCapture:{argv:['exec',id,'sh','-c','read counters']}};
  assert.equal(isTerminalSamplingRace('runner',state,error),true);
  for(const patch of [{stdout:''},{stdout:`container ${'c'.repeat(64)} is not running\r\n`},{stderr:'No such exec instance\n'},{killed:true},{signal:'SIGTERM'},{cgroupCapture:undefined}])assert.equal(isTerminalSamplingRace('runner',state,{...error,...patch}),false);
  for(const patch of [{running:true},{oomKilled:true},{exitCode:137},{id:'c'.repeat(64)}])assert.equal(isTerminalSamplingRace('runner',{...state,...patch},error),false);
  assert.equal(isTerminalSamplingRace('backend',state,error),false);
});

for (const stdout of ['OCI runtime exec failed: exec failed: cannot exec in a stopped container\r\n', 'OCI runtime exec failed: exec failed: unable to start container process: error executing setns process: exit status 1\r\n']) test(`OCI exec128 shutdown form is accepted only for the exact cleanly exited runner (${stdout.includes('setns') ? 'setns' : 'stopped'})`, () => {
  const id = 'd'.repeat(64), state = { id, status: 'exited', running: false, oomKilled: false, exitCode: 0 };
  const error = { code: 128, stdout, stderr: '', killed: false, signal: null, cgroupCapture: { argv: ['exec', id, 'sh', '-c', 'read counters'] } };
  assert.equal(isTerminalSamplingRace('runner', state, error), true);
  assert.equal(isTerminalSamplingRace('runner', { ...state, exitCode: 99 }, error), true);
  for (const patch of [{ running: true }, { status: 'dead' }, { oomKilled: true }, { exitCode: 137 }, { id: 'e'.repeat(64) }]) assert.equal(isTerminalSamplingRace('runner', { ...state, ...patch }, error), false);
  for (const patch of [{ code: 1 }, { stdout: 'OCI runtime exec failed: permission denied\r\n' }, { stdout: error.stdout + 'extra' }, { stderr: 'permission denied' }, { killed: true }, { signal: 'SIGTERM' }, { cgroupCapture: undefined }]) assert.equal(isTerminalSamplingRace('runner', state, { ...error, ...patch }), false);
  assert.equal(isTerminalSamplingRace('backend', state, error), false);
});

for(const form of [
  {name:'init-p broken pipe',code:128,stdout:'OCI runtime exec failed: exec failed: unable to start container process: error writing config to pipe: write init-p: broken pipe\r\n',stderr:''},
  {name:'TCP upgrade 409',code:1,stdout:'',stderr:'unable to upgrade to tcp, received 409\n'},
])test(`observed ${form.name} shutdown race requires exact message and clean owned runner`,()=>{
  const id='f'.repeat(64),state={id,status:'exited',running:false,oomKilled:false,exitCode:0};
  const error={...form,killed:false,signal:null,cgroupCapture:{argv:['exec',id,'sh','-c','read counters']}};
  assert.equal(isTerminalSamplingRace('runner',state,error),true);
  assert.equal(isTerminalSamplingRace('runner',{...state,exitCode:99},error),true);
  assert.equal(isTerminalSamplingRace('backend',state,error),false);
  for(const patch of [{running:true},{status:'dead'},{oomKilled:true},{exitCode:137},{exitCode:null},{id:'a'.repeat(64)}])assert.equal(isTerminalSamplingRace('runner',{...state,...patch},error),false);
  for(const patch of [{code:form.code===128?1:128},{stdout:form.stdout+'extra'},{stderr:form.stderr+'extra'},{killed:true},{signal:'SIGTERM'},{code:'ETIMEDOUT'},{cgroupCapture:undefined},{cgroupCapture:{argv:['exec','a'.repeat(64),'sh']}}])assert.equal(isTerminalSamplingRace('runner',state,{...error,...patch}),false);
});

test('Docker streaming terminal controls are parsed without changing retained raw bytes', () => {
  assert.deepEqual(parseStatsLine('\u001b[J\u001b[H{"CPUPerc":"1.78%"}\u001b[K'), { CPUPerc: '1.78%' });
  assert.equal(parseStatsLine('\u001b[K'), null);
  assert.throws(() => parseStatsLine('not JSON'));
});

const cgroup = (oom = 0) => `\n[cpu.stat]\nusage_usec 100\nnr_throttled 2\nthrottled_usec 30\n[memory.current]\n1048576\n[memory.peak]\n2097152\n[memory.events]\noom 0\noom_kill ${oom}\n`;
const evidence = () => ['backend', 'runner'].flatMap(role => [
  { type: 'lifecycle', role, elapsedMs: 0, source: { id: role, status: 'running', running: true, oomKilled: false, exitCode: 0, startedAt: 'start', restarts: 0, health: role === 'backend' ? 'healthy' : null } },
  { type: 'cgroup', role, elapsedMs: 0, source: cgroup() },
  ...[1000, 3000, 5000, 7000].map(elapsedMs => ({ type: 'stats', role, elapsedMs, source: { CPUPerc: '125.50%' } })),
  { type: 'cgroup', role, elapsedMs: 8000, source: cgroup() },
  { type: 'lifecycle', role, elapsedMs: 8000, source: { id: role, status: role === 'backend' ? 'running' : 'exited', running: role === 'backend', oomKilled: false, exitCode: 0, startedAt: 'start', restarts: 0, health: role === 'backend' ? 'healthy' : null } },
]);

test('parses native cgroup counters without treating unavailable fields as zero', () => {
  assert.deepEqual(parseCgroup(cgroup()).memoryEvents, { oom: 0, oom_kill: 0 });
  assert.equal(parseCgroup(cgroup()).memoryPeakBytes, 2097152);
  assert.equal(parseCgroup('[memory.peak]\nunavailable\n').memoryPeakBytes, null);
});

test('timestamped resource observations never certify generator headroom', () => {
  const report = summarizeResources(evidence());
  assert.equal(report.valid, true);
  assert.equal(report.stability, 'no_instability_observed');
  assert.equal(report.generatorHeadroom, 'unverified');
  assert.equal(report.containers.runner.peakCpuCores, 1.255);
  assert.equal(report.containers.backend.peakMemoryBytes, 1048576);
  assert.equal(report.containers.backend.cgroupLifetimePeakMemoryBytes, 2097152);
  assert.equal(report.containers.backend.throttledUsecDelta, 0);
});

test('a completed k6 threshold failure is not a runner crash', () => {
  const rows = evidence();
  rows.findLast(r => r.role === 'runner' && r.type === 'lifecycle').source.exitCode = 99;
  const report = summarizeResources(rows);
  assert.equal(report.valid, true);
  assert.equal(report.runnerOutcome, 'thresholds_failed');
});

test('missing, malformed, interrupted, or gapped monitoring is not valid evidence', () => {
  assert.equal(summarizeResources([]).valid, false);
  for (const change of [
    rows => rows.filter(r => !(r.role === 'runner' && r.type === 'stats')),
    rows => rows.filter(r => !(r.role === 'backend' && r.type === 'stats' && r.elapsedMs !== 1000)),
    rows => [...rows, { type: 'error', role: 'runner', operation: 'stats', exitCode: 1 }],
    rows => rows.map(r => r.type === 'stats' ? { ...r, source: { CPUPerc: 'NaN%' } } : r),
    rows => rows.filter(r => !(r.role === 'runner' && r.type === 'lifecycle' && r.source.status === 'exited')),
  ]) assert.equal(summarizeResources(change(evidence())).valid, false);
});

test('restarts, OOM events, health loss, counter resets and nonzero exits invalidate the run', () => {
  for (const patch of [{ restarts: 1 }, { startedAt: 'new' }, { oomKilled: true }, { status: 'exited', running: false }, { health: 'unhealthy' }, { memoryLimit: 1234 }, { nanoCpus: 2000000000 }]) {
    const rows = evidence();
    const last = rows.findLast(r => r.role === 'backend' && r.type === 'lifecycle');
    Object.assign(last.source, patch);
    assert.equal(summarizeResources(rows).valid, false, JSON.stringify(patch));
  }
  const oom = evidence();
  oom.findLast(r => r.role === 'backend' && r.type === 'cgroup').source = cgroup(1);
  assert.equal(summarizeResources(oom).valid, false);
  const reset = evidence();
  reset.find(r => r.role === 'backend' && r.type === 'cgroup').source = cgroup(1);
  assert.equal(summarizeResources(reset).valid, false, 'counter rollback is not a clean OOM delta');
  const exit = evidence();
  exit.findLast(r => r.role === 'runner' && r.type === 'lifecycle').source.exitCode = 137;
  assert.equal(summarizeResources(exit).valid, false);
});
