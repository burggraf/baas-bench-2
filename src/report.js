import { actions } from './workload.js';

export function summarize(summary, config) {
  const m = summary.metrics;
  const count = name => m[name]?.count ?? 0;
  const metric = (name, action) => `${name}{action:${action},phase:measurement}`;
  const total = actions.reduce((sum, a) => sum + count(metric('action_requested', a)), 0);
  const rows = Object.fromEntries(actions.map(action => {
    const requested = count(metric('action_requested', action));
    const completed = count(metric('action_completed', action));
    const failures = count(metric('action_failed', action));
    const duration = m[metric('action_duration', action)];
    const limit = ['listPublic', 'listOwn', 'read'].includes(action) ? 500 : 750;
    return [action, {
      requested, count: completed, successes: completed - failures, failures,
      observedPercent: total ? requested / total * 100 : 0, configuredPercent: config.weights[action],
      p95Ms: completed ? (duration?.['p(95)'] ?? null) : null, p99Ms: completed ? (duration?.['p(99)'] ?? null) : null,
      slo: completed < 1000 ? 'insufficient_samples' : (duration?.['p(95)'] <= limit && duration?.['p(99)'] <= 2000 && failures / completed < 0.01 ? 'pass' : 'fail'),
    }];
  }));
  const mixEnough = total >= 1000;
  const mixOk = !mixEnough || actions.every(a => {
    const p = config.weights[a] / 100;
    return Math.abs(rows[a].requested - total * p) <= 5 * Math.sqrt(total * p * (1 - p)) + 1;
  });
  const loginCount = count('auth_login_count');
  const loginMeasurementCount = count('auth_login_count{phase:measurement}');
  const loginDuration = m['auth_duration{operation:login,phase:measurement}'];
  const ttl = m.access_token_ttl_seconds;
  return {
    kind: 'fixed-vu-exploratory', certified: false,
    valid: count('users_finished') === config.vus && total > 0 && !count('target_unavailable') && !count('invalid_responses') && mixOk && actions.every(a => rows[a].requested === rows[a].count),
    mixEvidence: mixEnough ? (mixOk ? 'within_5_sigma_sampling_bound' : 'unexpected_distribution') : 'insufficient_samples',
    sloEvidence: actions.some(a => config.weights[a] > 0 && rows[a].count < 1000) || loginMeasurementCount < 1000 ? 'insufficient_samples' : 'exploratory_only',
    loginCount, loginMeasurementCount,
    loginP95Ms: loginMeasurementCount ? loginDuration?.['p(95)'] ?? null : null,
    loginP99Ms: loginMeasurementCount ? loginDuration?.['p(99)'] ?? null : null,
    authFailures: m.auth_failed?.passes ?? 0,
    refreshCount: count('auth_refresh_count'), naturalRefreshObserved: count('auth_refresh_count') > 0,
    accessTokenTtlSeconds: ttl?.count ? { min: ttl.min, max: ttl.max } : null,
    actions: rows,
    limitations: ['No capacity search, repetitions, soak, or load-generator headroom proof.', 'Logical action timers have millisecond resolution.', 'No automatic retries; prerequisites and SDK refresh are included in logical action latency.'],
  };
}
