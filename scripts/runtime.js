import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const capture = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
export const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function runtimeManifest(paths) {
  const backendId = capture('docker', ['compose', 'ps', '-q', 'trailbase']);
  assert.ok(backendId, 'Start the pilot first: npm run pilot:up');
  const [inspection] = JSON.parse(capture('docker', ['inspect', backendId]));
  assert.equal(inspection.State.Health.Status, 'healthy');
  const cgroup = JSON.parse(capture('docker', ['compose', 'exec', '-T', 'trailbase', 'sh', '-c',
    'read -r quota period < /sys/fs/cgroup/cpu.max; read -r memory < /sys/fs/cgroup/memory.max; read -r swap < /sys/fs/cgroup/memory.swap.max; printf "{\\"quota\\":%s,\\"period\\":%s,\\"memoryMax\\":%s,\\"swapMax\\":%s}" "$quota" "$period" "$memory" "$swap"',
  ]));
  const backend = { imageId: inspection.Image, cpus: inspection.HostConfig.NanoCpus / 1e9, memoryBytes: inspection.HostConfig.Memory, memorySwapBytes: inspection.HostConfig.MemorySwap };
  assert.equal(backend.cpus, 1); assert.equal(backend.memoryBytes, 4294967296);
  assert.equal(backend.memorySwapBytes, backend.memoryBytes);
  assert.equal(cgroup.quota / cgroup.period, 1); assert.equal(cgroup.memoryMax, 4294967296); assert.equal(cgroup.swapMax, 0);
  return {
    startedAt: new Date().toISOString(), controllerNodeVersion: process.version,
    revision: capture('git', ['rev-parse', 'HEAD']), dirty: capture('git', ['status', '--porcelain']).length > 0,
    serverVersion: capture('docker', ['compose', 'exec', '-T', 'trailbase', '/app/trail', '--version']),
    sdkVersion: JSON.parse(readFileSync('package-lock.json')).packages['node_modules/trailbase'].version,
    runnerImageId: capture('docker', ['image', 'inspect', 'baas-bench-2-pilot-runner', '--format', '{{.Id}}']),
    backendPlatform: capture('docker', ['image', 'inspect', inspection.Image, '--format', '{{.Os}}/{{.Architecture}}']),
    runnerPlatform: capture('docker', ['image', 'inspect', 'baas-bench-2-pilot-runner', '--format', '{{.Os}}/{{.Architecture}}']),
    backend, cgroup, hashes: Object.fromEntries(paths.map(path => [path, hash(path)])),
  };
}

export function runRunner(directory, name, args, extra = []) {
  const result = spawnSync('docker', ['compose', 'run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, ...extra, 'runner', ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  writeFileSync(`${directory}/${name}-stdout.log`, result.stdout ?? '');
  writeFileSync(`${directory}/${name}-stderr.log`, result.stderr ?? '');
  writeFileSync(`${directory}/${name}-exit.json`, JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.code }));
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  return result.status;
}
