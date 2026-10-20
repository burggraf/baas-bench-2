import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

const capture = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
capture('npm', ['run', 'build']);
mkdirSync('results', { recursive: true });
const directory = mkdtempSync('results/conformance-');
const id = directory.split('/').at(-1);
const backendId = capture('docker', ['compose', 'ps', '-q', 'trailbase']);
assert.ok(backendId, 'Start the pilot backend first: npm run pilot:up');
const [inspection] = JSON.parse(capture('docker', ['inspect', backendId]));
const cgroup = JSON.parse(capture('docker', ['compose', 'exec', '-T', 'trailbase', 'sh', '-c',
  'read -r quota period < /sys/fs/cgroup/cpu.max; read -r memory < /sys/fs/cgroup/memory.max; read -r swap < /sys/fs/cgroup/memory.swap.max; printf "{\\"quota\\":%s,\\"period\\":%s,\\"memoryMax\\":%s,\\"swapMax\\":%s}" "$quota" "$period" "$memory" "$swap"',
]));
const backend = { imageId: inspection.Image, cpus: inspection.HostConfig.NanoCpus / 1e9, memoryBytes: inspection.HostConfig.Memory, memorySwapBytes: inspection.HostConfig.MemorySwap };
const manifest = {
  kind: 'conformance-only', startedAt: new Date().toISOString(),
  revision: capture('git', ['rev-parse', 'HEAD']), dirty: capture('git', ['status', '--porcelain']).length > 0,
  serverVersion: capture('docker', ['compose', 'exec', '-T', 'trailbase', '/app/trail', '--version']),
  sdkVersion: JSON.parse(readFileSync('package-lock.json')).packages['node_modules/trailbase'].version,
  runnerImageId: capture('docker', ['image', 'inspect', 'baas-bench-2-pilot-runner', '--format', '{{.Id}}']),
  backendPlatform: capture('docker', ['image', 'inspect', inspection.Image, '--format', '{{.Os}}/{{.Architecture}}']),
  runnerPlatform: capture('docker', ['image', 'inspect', 'baas-bench-2-pilot-runner', '--format', '{{.Os}}/{{.Architecture}}']),
  backend, cgroup,
  hashes: Object.fromEntries(['dist/conformance.js', 'package-lock.json', 'compose.yaml', 'backends/trailbase/configuration/config.textproto', 'backends/trailbase/configuration/migrations/main/U1792454400__social_schema.sql'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
};
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
assert.equal(backend.cpus, 1);
assert.equal(backend.memoryBytes, 4294967296);
assert.equal(backend.memorySwapBytes, backend.memoryBytes);
assert.equal(cgroup.quota / cgroup.period, 1);
assert.equal(cgroup.memoryMax, 4294967296);
assert.equal(cgroup.swapMax, 0);

function run(name, args) {
  const result = spawnSync('docker', ['compose', 'run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, 'runner', ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  writeFileSync(`${directory}/${name}-stdout.log`, result.stdout ?? '');
  writeFileSync(`${directory}/${name}-stderr.log`, result.stderr ?? '');
  writeFileSync(`${directory}/${name}-exit.json`, JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.code }));
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  assert.equal(result.status, 0, `${name} failed; source evidence saved in ${directory}`);
}
run('node', ['node', 'scripts/conformance.js']);
run('k6', ['k6', 'run', '--out', `json=/results/${id}/k6-metrics.json.gz`, '--summary-export', `/results/${id}/k6-summary.json`, '/scripts/conformance.js']);
console.log(`Conformance evidence: ${directory} (not a capacity result)`);
