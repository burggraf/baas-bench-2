import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { capture } from '../scripts/runtime.js';

test('TrailBase config and Docker process have an explicit 16384 open-file limit without changing CPU or RAM', () => {
  const service = JSON.parse(capture('docker', ['compose', 'config', '--format', 'json'])).services.trailbase;
  assert.deepEqual(service.ulimits?.nofile, { soft: 16384, hard: 16384 });
  assert.equal(service.cpus, 1); assert.equal(service.mem_limit, '4294967296'); assert.equal(service.memswap_limit, '4294967296');
  const image = capture('docker', ['image', 'inspect', 'baas-bench-2-pilot-trailbase', '--format', '{{.Id}}']);
  const limits = capture('docker', ['run', '--rm', '--network=none', '--cpus=1', '--memory=4g', '--memory-swap=4g',
    '--ulimit', `nofile=${service.ulimits.nofile.soft}:${service.ulimits.nofile.hard}`, '--entrypoint=/bin/sh', image,
    '-c', 'ulimit -Sn; ulimit -Hn']).split(/\s+/).map(Number);
  assert.deepEqual(limits, [16384, 16384]);
});

test('three fresh API-seeded deployments have the same logical baseline without touching the retained pilot', { timeout: 180000 }, () => {
  assert.ok(!existsSync('.fixtures/trailbase.json'));
  const result = spawnSync(process.execPath, ['scripts/baseline.js', 'configs/smoke.json'], { encoding: 'utf8', timeout: 150000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const directory = result.stdout.match(/Baseline proof: (results\/baseline-[a-zA-Z0-9]{6})/)?.[1];
  assert.ok(directory, 'the baseline command must produce independently verifiable evidence');
  const report = JSON.parse(readFileSync(`${directory}/report.json`));
  assert.equal(report.valid, true); assert.equal(report.certified, false);
  assert.equal(report.trials.length, 3);
  assert.equal(new Set(report.trials.map(t => t.volume.Name)).size, 3);
  assert.equal(new Set(report.trials.map(t => t.identityHash)).size, 3);
  assert.equal(new Set(report.trials.map(t => t.baseline.logicalHash)).size, 1);
  for (const [index, trial] of report.trials.entries()) {
    const prefix = `${directory}/trial-${index + 1}`;
    const requests = readFileSync(`${prefix}.controller-requests.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(requests.some(r => r.route === '/api/auth/v1/register' && r.stage === 'headers'));
    assert.ok(requests.some(r => r.route === '/api/records/v1/likes' && r.stage === 'body'));
    assert.ok(requests.every(r => Number.isFinite(r.durationMs) && r.timeoutMs === 10000));
    assert.doesNotMatch(JSON.stringify(requests), /auth_token|refresh_token|"password"|\?filter|eyJ[A-Za-z0-9_-]{8,}\./);
    const evidence = JSON.parse(readFileSync(`${prefix}.backend-evidence.json`));
    assert.equal(evidence.complete, true);assert.equal(evidence.backendId, trial.backendId);
    assert.equal(evidence.inspection.running, true);assert.equal(evidence.inspection.oomKilled, false);
    assert.ok(evidence.cgroups.source.includes('[memory.events]'));
    assert.equal(evidence.cgroups.capture.method,process.platform==='linux'?'host-cgroup-v2':'docker-exec');
    assert.equal(statSync(evidence.logs.privateDirectory).mode & 0o777, 0o700);
    for (const name of ['stdout.log', 'stderr.log']) assert.equal(statSync(`${evidence.logs.privateDirectory}/${name}`).mode & 0o777, 0o600);
    assert.equal(trial.baseline.posts, 40); assert.equal(trial.baseline.likes, 40);
    assert.equal(trial.apiReset.posts, 0); assert.equal(trial.volumeRetained, true);
  }
  assert.deepEqual(report.pilotVolumeAfter, report.pilotVolumeBefore);
  assert.doesNotMatch(JSON.stringify(report), /auth_token|refresh_token|"password"/);
  assert.ok(!existsSync('.fixtures/trailbase.json'));
  assert.ok(!existsSync('.fixtures/operation.lock'));
});
