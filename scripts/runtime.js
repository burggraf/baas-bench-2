import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';

const executeFile = promisify(execFile);
export async function execute(command, args, options) {
  const pending = executeFile(command, args, options), result = await pending;
  // A timed-out CLI can handle SIGTERM and exit zero, making plain promisify(execFile) resolve.
  if (pending.child.killed) throw Object.assign(new Error('Command was killed despite a zero exit status'), { ...result, code: 'ERR_CHILD_PROCESS_KILLED', killed: true, signal: pending.child.signalCode, exitCode: pending.child.exitCode, timeoutMs: options?.timeout ?? null });
  return result;
}

export function nativeContainerPlatform(architecture = process.arch) {
  assert.ok(['x64', 'arm64'].includes(architecture), 'Only native AMD64/ARM64 benchmark hosts are supported');
  return `linux/${architecture === 'x64' ? 'amd64' : 'arm64'}`;
}

export async function captureHostMemory(hostPlatform = process.platform) {
  assert.ok(['linux', 'darwin'].includes(hostPlatform), 'Host memory monitoring requires Linux or macOS');
  const result = await execute(hostPlatform === 'linux' ? 'cat' : 'sysctl', hostPlatform === 'linux' ? ['/proc/meminfo'] : ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 });
  return { platform: hostPlatform, ...result, exitCode: 0 };
}

export const capture = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000 }).trim();
export const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function runtimeManifest(paths, { service = 'trailbase', executable = '/app/trail', sdk = 'trailbase' } = {}) {
  assert.ok(['trailbase', 'pocketbase'].includes(service));
  const backendId = capture('docker', ['compose', 'ps', '-q', service]);
  assert.ok(backendId, 'Start the pilot first: npm run pilot:up');
  const [inspection] = JSON.parse(capture('docker', ['inspect', backendId]));
  assert.equal(inspection.State.Health.Status, 'healthy');
  const cgroup = JSON.parse(capture('docker', ['compose', 'exec', '-T', service, 'sh', '-c',
    'read -r quota period < /sys/fs/cgroup/cpu.max; read -r memory < /sys/fs/cgroup/memory.max; read -r swap < /sys/fs/cgroup/memory.swap.max; printf "{\\"quota\\":%s,\\"period\\":%s,\\"memoryMax\\":%s,\\"swapMax\\":%s}" "$quota" "$period" "$memory" "$swap"',
  ]));
  const backend = { imageId: inspection.Image, cpus: inspection.HostConfig.NanoCpus / 1e9, memoryBytes: inspection.HostConfig.Memory, memorySwapBytes: inspection.HostConfig.MemorySwap };
  assert.equal(backend.cpus, 1); assert.equal(backend.memoryBytes, 4294967296);
  assert.equal(backend.memorySwapBytes, backend.memoryBytes);
  assert.equal(cgroup.quota / cgroup.period, 1); assert.equal(cgroup.memoryMax, 4294967296); assert.equal(cgroup.swapMax, 0);
  const backendPlatform = capture('docker', ['image', 'inspect', inspection.Image, '--format', '{{.Os}}/{{.Architecture}}']);
  const runnerPlatform = capture('docker', ['image', 'inspect', 'baas-bench-2-pilot-runner', '--format', '{{.Os}}/{{.Architecture}}']);
  assert.equal(backendPlatform, nativeContainerPlatform(), 'Backend must run natively');
  assert.equal(runnerPlatform, nativeContainerPlatform(), 'Runner must run natively');
  return {
    startedAt: new Date().toISOString(), controllerNodeVersion: process.version,
    host: { platform: platform(), arch: process.arch, release: release(), cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() },
    revision: capture('git', ['rev-parse', 'HEAD']), dirty: capture('git', ['status', '--porcelain']).length > 0,
    serverVersion: capture('docker', ['compose', 'exec', '-T', service, executable, '--version']),
    sdkVersion: JSON.parse(readFileSync('package-lock.json')).packages[`node_modules/${sdk}`].version,
    runnerImageId: capture('docker', ['image', 'inspect', 'baas-bench-2-pilot-runner', '--format', '{{.Id}}']),
    backendPlatform, runnerPlatform,
    backend, cgroup, hashes: Object.fromEntries(paths.map(path => [path, hash(path)])),
  };
}

export async function runRunner(directory, name, args, extra = [], { remove = true, signal } = {}) {
  signal?.throwIfAborted();
  const out = openSync(`${directory}/${name}-stdout.log`, 'w');
  const err = openSync(`${directory}/${name}-stderr.log`, 'w');
  let error, timer;
  const child = spawn('docker', ['compose', 'run', ...(remove ? ['--rm'] : []), '--user', `${process.getuid()}:${process.getgid()}`, ...extra, 'runner', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => {
    child.kill('SIGTERM');
    timer ??= setTimeout(() => child.kill('SIGKILL'), 2000);
  };
  signal?.addEventListener('abort', stop, { once: true });
  for (const [stream, fd, output] of [[child.stdout, out, process.stdout], [child.stderr, err, process.stderr]]) {
    stream.on('data', data => {
      try { writeSync(fd, data); output.write(data); }
      catch (failure) { error = failure.code ?? 'output_failed'; stop(); }
    });
  }
  child.once('error', failure => { error = failure.code; });
  const result = await new Promise(resolve => child.once('close', (status, signal) => resolve({ status: error ? null : status, signal, error })));
  clearTimeout(timer); signal?.removeEventListener('abort', stop);
  closeSync(out); closeSync(err);
  writeFileSync(`${directory}/${name}-exit.json`, JSON.stringify(result));
  return result.status;
}
