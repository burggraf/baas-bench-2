import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { summarize } from '../src/report.js';
const config = JSON.parse(readFileSync('configs/smoke.json'));

test('reports action mix/failures and refuses a low-sample SLO or capacity claim', () => {
  const metrics = { users_finished: { count: 2 }, target_unavailable: { count: 0 }, invalid_responses: { count: 0 }, auth_login_count: { count: 4 } };
  for (const [action, weight] of Object.entries(config.weights)) {
    metrics[`action_requested{action:${action},phase:measurement}`] = { count: weight };
    metrics[`action_completed{action:${action},phase:measurement}`] = { count: weight };
    metrics[`action_failed{action:${action},phase:measurement}`] = { count: 0 };
    metrics[`action_duration{action:${action},phase:measurement}`] = { 'p(95)': 10, 'p(99)': 20 };
  }
  const report = summarize({ metrics }, config);
  assert.equal(report.valid, true);
  assert.equal(report.certified, false);
  assert.equal(report.sloEvidence, 'insufficient_samples');
  assert.equal(report.actions.like.observedPercent, 17);
  assert.equal(report.loginMeasurementCount, 0, 'warm-up logins are not measurement evidence');
  assert.equal(report.naturalRefreshObserved, false);
  assert.equal(summarize({ metrics: {} }, config).actions.like.p95Ms, null);
  metrics.target_unavailable.count = 1;
  assert.equal(summarize({ metrics }, config).valid, false);
  metrics.target_unavailable.count = 0;
  metrics['action_completed{action:like,phase:measurement}'].count = 1;
  assert.equal(summarize({ metrics }, config).valid, false);
});
