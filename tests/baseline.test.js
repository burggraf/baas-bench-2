import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBaselineVolume, assertBaselineBackend } from '../scripts/baseline.js';
import * as baselineModule from '../scripts/baseline.js';
import { readFileSync } from 'node:fs';

test('fresh workload defaults preserve the approved 50-user pilot and tiny correctness smoke', () => {
  assert.equal(typeof baselineModule.baselinePlan, 'function');
  const plan = baselineModule.baselinePlan(['--workload']);
  assert.equal(plan.workload, true); assert.equal(plan.trials, 1);
  assert.deepEqual(plan.runnerBudget, { cpus: 4, memoryBytes: 2147483648 });
  assert.deepEqual(plan.config, { ...JSON.parse(readFileSync('configs/pilot-small.json')), vus: 50 });
  const smoke = baselineModule.baselinePlan(['--workload', '--smoke']);
  assert.deepEqual(smoke.config, JSON.parse(readFileSync('configs/smoke.json')));
  assert.deepEqual(smoke.runnerBudget, plan.runnerBudget);
  assert.equal(baselineModule.baselinePlan([]).config.vus, 10);
  assert.equal(baselineModule.baselinePlan(['configs/smoke.json']).trials, 3);
  for (const args of [['--smoke'], ['--workload', '--workload'], ['--workload', '--smoke', '--smoke'], ['--workload', '--cpus=8'], ['--workload', 'configs/smoke.json']]) assert.throws(() => baselineModule.baselinePlan(args));
});

test('100-user sizing changes only active users; defaults, budgets and smoke remain bounded', () => {
  const normal = baselineModule.baselinePlan(['--workload']);
  for (const args of [['--workload', '--vus=100'], ['--vus=100', '--workload']]) {
    assert.deepEqual(baselineModule.baselinePlan(args), { ...normal, config: { ...normal.config, vus: 100 } });
  }
  for (const args of [['--vus=100'], ['--workload', '--vus=100', '--smoke'], ['--workload', '--vus=100', '--vus=100'], ['--workload', '--vus=50'], ['--workload', '--vus=200'], ['--workload', '--vus', '100'], ['--workload', '--vus=100', '--cpus=8']]) assert.throws(() => baselineModule.baselinePlan(args));
});

const run = 'baseline-Abc123', volume = `baas-bench-2-pilot_${run}-1`;
const state = { Name: volume, Driver: 'local', Scope: 'local', Options: null, Labels: { 'baas-bench-2.baseline': run, 'baas-bench-2.trial': '1' }, CreatedAt: '2026-10-20T00:00:00Z' };
const backend = { id: 'a'.repeat(64), project: 'baas-bench-2-pilot', service: 'trailbase', mounts: [{ Type: 'volume', Name: volume, Destination: '/app/traildepot' }] };

test('fresh baseline volume identity excludes retained pilot, foreign labels and remote/bind drivers', () => {
  assertBaselineVolume(state, run, 1);
  for (const changed of [{ Name: 'baas-bench-2-pilot_trailbase-data' }, { Driver: 'nfs' }, { Scope: 'global' }, { Options: { device: '/private/data' } }, { Labels: {} }, { CreatedAt: 'bad' }]) {
    assert.throws(() => assertBaselineVolume({ ...state, ...changed }, run, 1));
  }
  assert.throws(() => assertBaselineVolume(state, '../escape', 1));
  assert.throws(() => assertBaselineVolume(state, run, 4));
});

test('baseline shutdown requires the same backend ID, fixed project/service and exact fresh-volume mount', () => {
  assertBaselineBackend(backend, backend.id, volume);
  for (const changed of [{ id: 'b'.repeat(64) }, { project: 'other' }, { service: 'runner' }, { mounts: [{ ...backend.mounts[0], Name: 'baas-bench-2-pilot_trailbase-data' }] }, { mounts: [{ ...backend.mounts[0], Type: 'bind' }] }]) {
    assert.throws(() => assertBaselineBackend({ ...backend, ...changed }, backend.id, volume));
  }
});
