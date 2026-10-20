import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { closeSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const execute = promisify(execFile);
const docker = async args => (await execute('docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })).stdout.trim();
const missing = error => /No such (object|container)/i.test(error.stderr ?? '');
const format = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"running":{{json .State.Running}},"run":{{json (index .Config.Labels "baas-bench-2.run")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}';

export async function stopOwnedRunner(runId, image, { remove = true } = {}) {
  assert.match(runId, /^social-[a-zA-Z0-9]{6}$/);
  assert.ok(typeof image === 'string' && image.length > 0, 'Missing runner image identity');
  let state;
  try { state = JSON.parse(await docker(['inspect', '--format', format, `${runId}-runner`])); }
  catch (error) { if (missing(error)) return { status: 'absent' }; throw error; }
  assert.equal(state.name, `/${runId}-runner`, 'Refuse unrelated runner name');
  assert.equal(state.run, runId, 'Refuse unrelated run label');
  assert.equal(state.project, 'baas-bench-2-pilot', 'Refuse unrelated project');
  assert.equal(state.service, 'runner', 'Refuse unrelated service');
  assert.equal(state.image, image, 'Refuse unrelated runner image');
  assert.match(state.id, /^[a-f0-9]{64}$/);
  // Pin all mutations to the inspected ID, never a name that could be replaced.
  if (state.running) await docker(['stop', '--signal', 'SIGINT', '--timeout', '10', state.id]);
  if (remove) await docker(['rm', state.id]);
  return { status: remove ? 'removed' : 'stopped', id: state.id, stopped: state.running };
}

function alive(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid operation owner PID');
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export async function recoverOperation(directory = '.fixtures') {
  const parent = lstatSync(directory);
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && !(parent.mode & 0o077), 'Recovery requires a private directory');
  const claim = openSync(`${directory}/recovery.lock`, 'wx', 0o600);
  try {
    writeFileSync(claim, JSON.stringify({ pid: process.pid }));
    const path = `${directory}/operation.lock`, stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'Refuse insecure operation lock');
    const text = readFileSync(path, 'utf8'), operation = JSON.parse(text);
    assert.equal(operation.version, 1, 'Unknown operation lock; inspect manually');
    assert.ok(['prepare', 'run', 'reset'].includes(operation.command));
    assert.ok(!alive(operation.pid), 'Operation owner is active; refuse recovery');
    if (operation.monitorPid) assert.ok(!alive(operation.monitorPid), 'Monitor is still active; wait for shutdown before recovery');
    const cleanup = operation.runId ? await stopOwnedRunner(operation.runId, operation.runnerImageId) : { status: 'not_launched' };
    assert.equal(lstatSync(path).ino, stat.ino, 'Operation lock changed during recovery');
    assert.equal(readFileSync(path, 'utf8'), text, 'Operation lock changed during recovery');
    unlinkSync(path);
    return { recovered: true, command: operation.command, runId: operation.runId ?? null, cleanup };
  } finally { closeSync(claim); unlinkSync(`${directory}/recovery.lock`); }
}
