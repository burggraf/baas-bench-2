import { spawn, execFile } from 'node:child_process';
import { promisify, stripVTControlCharacters } from 'node:util';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summarizeResources } from '../src/resources.js';

export function parseStatsLine(line) {
  const clean = stripVTControlCharacters(line).trim();
  return clean ? JSON.parse(clean) : null;
}

export function isTerminalSamplingRace(role, state, error) {
  return role === 'runner' && state?.status === 'exited' && state.running === false &&
    /^[a-f0-9]{64}$/.test(state.id) && error.code === 1 &&
    new RegExp(`^Error response from daemon: container ${state.id} is not running\\s*$`, 'i').test(error.stderr ?? '');
}

export function parseRunnerCgroups(text, consumed, capturedMs, running) {
  const lines = text.split('\n'), tail = lines.pop(), rows = lines.filter(Boolean).map(JSON.parse);
  if (rows.length < consumed || (!running && (tail || rows.at(-1)?.final !== true))) throw new Error('Incomplete self cgroups');
  const added = rows.slice(consumed);
  for (const row of added) {
    if (!Number.isFinite(Date.parse(row.at)) || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0 || row.elapsedMs < capturedMs ||
        (capturedMs >= 0 && row.elapsedMs - capturedMs > 5000) || typeof row.source !== 'string' || typeof row.final !== 'boolean') throw new Error('Malformed/gapped self cgroups');
    capturedMs = row.elapsedMs;
  }
  return { rows: added, consumed: rows.length, capturedMs };
}

const execute = promisify(execFile);
const inspection = '{"id":{{json .Id}},"status":{{json .State.Status}},"running":{{json .State.Running}},"oomKilled":{{json .State.OOMKilled}},"exitCode":{{json .State.ExitCode}},"startedAt":{{json .State.StartedAt}},"finishedAt":{{json .State.FinishedAt}},"restarts":{{json .RestartCount}},"health":{{if index .State "Health"}}{{json .State.Health.Status}}{{else}}null{{end}},"run":{{json (index .Config.Labels "baas-bench-2.run")}},"nanoCpus":{{json .HostConfig.NanoCpus}},"cpuQuota":{{json .HostConfig.CpuQuota}},"cpuPeriod":{{json .HostConfig.CpuPeriod}},"cpuset":{{json .HostConfig.CpusetCpus}},"memoryLimit":{{json .HostConfig.Memory}},"memorySwap":{{json .HostConfig.MemorySwap}}}';
const cgroupCommand = 'for f in cpu.stat memory.current memory.peak memory.events; do printf "\\n[%s]\\n" "$f"; cat "/sys/fs/cgroup/$f" 2>/dev/null || printf "unavailable\\n"; done';

export async function startMonitor(directory, backendId, runnerName, runnerCgroupFile) {
  const err = openSync(`${directory}/monitor-stderr.log`, 'w');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), directory, backendId, runnerName, ...(runnerCgroupFile ? [runnerCgroupFile] : [])], { stdio: ['ignore', 'ignore', err, 'ipc'] });
  closeSync(err);
  const ended = new Promise(resolve => {
    child.once('error', () => resolve({ status: null, error: 'spawn_failed' }));
    child.once('exit', (status, signal) => resolve({ status, signal }));
  });
  const ready = new Promise(resolve => child.once('message', resolve));
  const initial = await Promise.race([ready, ended]);
  if (initial?.type !== 'ready') throw new Error('Resource monitor startup failed');
  return { pid: child.pid, async stop() {
    if (child.connected) child.send('stop', error => { if (error) child.kill('SIGTERM'); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
    const exit = await ended;
    clearTimeout(timer);
    writeFileSync(`${directory}/monitor-exit.json`, JSON.stringify(exit));
    if (exit.status !== 0) throw new Error('Resource monitor failed; inspect retained evidence');
    return JSON.parse(readFileSync(`${directory}/resources-summary.json`));
  } };
}

async function collect(directory, backendId, runnerName, runnerCgroupFile) {
  const began = process.hrtime.bigint(), records = [], streams = new Map();
  const errorFd = openSync(`${directory}/docker-stats-stderr.log`, 'w');
  writeFileSync(`${directory}/inspect-stderr.log`, '');
  writeFileSync(`${directory}/cgroup-stderr.log`, '');
  let stopping = false;
  const record = (type, role, source, extra = {}) => {
    const row = { at: new Date().toISOString(), elapsedMs: Number(process.hrtime.bigint() - began) / 1e6, type, role, source, ...extra };
    records.push(row);
    try { appendFileSync(`${directory}/resources.jsonl`, JSON.stringify(row) + '\n'); }
    catch { stopping = true; process.exitCode = 1; }
  };
  const docker = args => execute('docker', args, { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 });
  const stats = (role, id) => {
    if (streams.has(role)) return;
    const child = spawn('docker', ['stats', '--format', '{{json .}}', id], { stdio: ['ignore', 'pipe', errorFd] });
    let pending = '';
    const consume = line => {
      try { const source = parseStatsLine(line); if (source) record('stats', role, source); }
      catch { record('error', role, null, { operation: 'stats_json' }); }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => {
      try { appendFileSync(`${directory}/${role}-docker-stats.log`, text); }
      catch { stopping = true; process.exitCode = 1; }
      pending += text;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines.filter(Boolean)) consume(line);
    });
    const ended = new Promise(resolve => {
      child.once('error', () => { record('error', role, null, { operation: 'stats_spawn' }); resolve(); });
      child.once('close', code => {
        consume(pending);
        if (!stopping && code !== 0) record('error', role, null, { operation: 'stats_exit', exitCode: code });
        resolve();
      });
    });
    streams.set(role, { child, ended });
  };
  let runnerSeen = false, consumed = 0, capturedMs = -1;
  const selfCgroups = state => {
    if (!existsSync(runnerCgroupFile)) {
      if (!state.running) record('error', 'runner', null, { operation: 'self_cgroup_missing' });
      return;
    }
    try {
      const next = parseRunnerCgroups(readFileSync(runnerCgroupFile, 'utf8'), consumed, capturedMs, state.running);
      for (const row of next.rows) record('cgroup', 'runner', row.source, { collection: 'container-self', capturedAt: row.at, capturedElapsedMs: row.elapsedMs, capturedFinal: row.final });
      consumed = next.consumed; capturedMs = next.capturedMs;
    } catch { record('error', 'runner', null, { operation: 'self_cgroup_invalid' }); }
  };
  const sample = async (role, target) => {
    let state;
    try { state = JSON.parse((await docker(['inspect', '--format', inspection, target])).stdout); }
    catch (error) {
      appendFileSync(`${directory}/inspect-stderr.log`, error.stderr ?? 'Invalid inspector JSON\n');
      if (role !== 'runner' || runnerSeen || !/No such (object|container)/i.test(error.stderr ?? '')) record('error', role, null, { operation: 'inspect' });
      return;
    }
    if (role === 'runner') {
      if (state.run !== directory.split('/').at(-1)) { record('error', role, null, { operation: 'ownership' }); return; }
      runnerSeen = true;
    }
    if (state.status === 'created') { record('discovery', role, state); return; }
    record('lifecycle', role, state);
    if (role === 'runner' && runnerCgroupFile) {
      if (state.running) stats(role, state.id);
      selfCgroups(state);
      return;
    }
    if (state.running) {
      stats(role, state.id);
      try { record('cgroup', role, (await docker(['exec', state.id, 'sh', '-c', cgroupCommand])).stdout); }
      catch (error) {
        appendFileSync(`${directory}/cgroup-stderr.log`, error.stderr ?? 'Cgroup command failed\n');
        let terminal;
        if (role === 'runner') {
          try { terminal = JSON.parse((await docker(['inspect', '--format', inspection, state.id])).stdout); }
          catch (failure) { appendFileSync(`${directory}/inspect-stderr.log`, failure.stderr ?? 'Terminal inspection failed\n'); }
        }
        if (isTerminalSamplingRace(role, terminal, error)) record('lifecycle', role, terminal);
        else record('error', role, null, { operation: 'cgroup', exitCode: error.code });
      }
    }
  };
  process.on('message', message => { if (message === 'stop') stopping = true; });
  process.on('disconnect', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  try {
    await sample('backend', backendId);
    if (process.connected) process.send({ type: 'ready' }, error => { if (error) stopping = true; });
    else stopping = true;
    while (!stopping) {
      await sample('backend', backendId); await sample('runner', runnerName);
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    stopping = true;
    try { await sample('backend', backendId); await sample('runner', runnerName); }
    finally {
      for (const { child } of streams.values()) child.kill('SIGTERM');
      const timer = setTimeout(() => { for (const { child } of streams.values()) child.kill('SIGKILL'); }, 2000);
      await Promise.all([...streams.values()].map(s => s.ended));
      clearTimeout(timer); closeSync(errorFd);
      try { writeFileSync(`${directory}/resources-summary.json`, JSON.stringify(summarizeResources(records), null, 2)); }
      finally { if (process.connected) process.disconnect(); }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await collect(...process.argv.slice(2)); }
  catch { process.exitCode = 1; }
}
