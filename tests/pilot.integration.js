import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

// Requires the explicitly started, isolated pilot backend and built runner.
test('pinned SDK conformance saves raw evidence and verifies actual resource limits', () => {
  mkdirSync('results', { recursive: true });
  const before = new Set(readdirSync('results'));
  const k6 = spawnSync(process.execPath, ['scripts/run-k6.js'], { encoding: 'utf8' });
  assert.equal(k6.status, 0, k6.stdout + k6.stderr);
  const created = readdirSync('results').filter(name => !before.has(name));
  assert.equal(created.length, 1);
  const directory = `results/${created[0]}`;
  const summary = JSON.parse(readFileSync(`${directory}/k6-summary.json`));
  assert.equal(summary.metrics.conformance_completed.count, 2);
  assert.equal(summary.metrics.checks.passes, 90);
  assert.equal(summary.metrics.checks.fails, 0);
  assert.match(readFileSync(`${directory}/node-stdout.log`, 'utf8'), /Native SDK conformance passed: 45 checks/);
  const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`));
  assert.equal(manifest.kind, 'conformance-only');
  assert.equal(manifest.backend.memoryBytes, 4294967296);
  assert.equal(manifest.backend.cpus, 1);
  assert.equal(manifest.cgroup.swapMax, 0);
  assert.ok(readFileSync(`${directory}/k6-metrics.json.gz`).length > 0);
  assert.match(readFileSync(`${directory}/k6-stdout.log`, 'utf8'), /90 out of 90/);
});
