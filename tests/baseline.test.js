import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBaselineVolume, assertBaselineBackend } from '../scripts/baseline.js';

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
