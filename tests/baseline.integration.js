import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

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
  for (const trial of report.trials) {
    assert.equal(trial.baseline.posts, 40); assert.equal(trial.baseline.likes, 40);
    assert.equal(trial.apiReset.posts, 0); assert.equal(trial.volumeRetained, true);
  }
  assert.deepEqual(report.pilotVolumeAfter, report.pilotVolumeBefore);
  assert.doesNotMatch(JSON.stringify(report), /auth_token|refresh_token|"password"/);
  assert.ok(!existsSync('.fixtures/trailbase.json'));
  assert.ok(!existsSync('.fixtures/operation.lock'));
});
