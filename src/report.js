import { actions } from './workload.js';

export function summarize(summary, config, evidence = null) {
  const prepared = config.version === 'social-prepared-v1';
  if(prepared&&(!summary||!summary.metrics||typeof summary.metrics!=='object'||Array.isArray(summary.metrics)||!Object.keys(summary.metrics).length))return {
    kind:'prepared-session-fixed-vu-exploratory',workloadVersion:config.version,certified:false,valid:false,preparedEvidenceValid:false,summaryAvailable:false,
    preparation:{...evidence?.preparation,protocol:'loopback-prepared-v1',loginAttempts:null,loginSuccesses:null,loginFailures:null,summaryAvailable:false},
    participation:evidence?.participation??null,phaseTiming:evidence?.phaseTiming??null,evidenceIssues:[...new Set([...(evidence?.issues??[]),'missing_or_invalid_summary'])],
    applicationEvidence:{state:'unavailable'},authenticationEvidence:{login:{state:'unavailable'},refresh:{state:'unavailable'}},
    usersFinished:null,requestedActions:null,authFailures:null,loginCount:null,loginMeasurementCount:null,loginP95Ms:null,loginP99Ms:null,refreshCount:null,actions:{},sloEvidence:'unavailable',
    limitations:['Native summary unavailable: no zero authentication failures, action totals or successful measurement are inferred.','Not a capacity, repetition, soak, natural-expiry or headroom proof.'],
  };
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
  const loginDuration = m[prepared ? 'auth_success_duration{phase:measurement}' : 'auth_duration{operation:login,phase:measurement}'];
  const ttl = m.access_token_ttl_seconds;
  const applicationState = actions.some(a => config.weights[a] > 0 && rows[a].count < 1000) ? 'insufficient_samples' : 'exploratory_only';
  const phases=prepared?Object.fromEntries(['preparation','ramp','warmup','measurement','cleanup'].map(phase=>{
    const successes=count(`auth_login_count{phase:${phase}}`),duration=m[`auth_success_duration{phase:${phase}}`],logout=m[`auth_failed{operation:logout,phase:${phase}}`];
    return [phase,{login:{attempts:count(`auth_login_attempts{phase:${phase}}`),successes,failures:count(`auth_login_failed{phase:${phase}}`),p95Ms:successes?duration?.['p(95)']??null:null,p99Ms:successes?duration?.['p(99)']??null:null},logout:{attempts:(logout?.passes??0)+(logout?.fails??0),failures:logout?.passes??0},refresh:{requests:count(`auth_refresh_count{phase:${phase}}`),failures:m[`auth_http_failed{operation:refresh,phase:${phase}}`]?.passes??0}}];
  })):null;
  const prep=phases?.preparation.login,probe=m.prepared_probe_failed;
  const preparationCountsValid=!prepared||evidence?.preparation?.status!=='released'||prep.attempts===config.vus&&prep.successes===config.vus&&prep.failures===0&&probe?.fails===config.vus&&probe?.passes===0;
  const measuredRefreshes=prepared?count('auth_refresh_count{phase:measurement}'):0;
  return {
    kind: prepared ? 'prepared-session-fixed-vu-exploratory' : 'fixed-vu-exploratory', certified: false,
    ...(prepared ? {
      workloadVersion: config.version, preparedEvidenceValid: evidence?.valid === true&&preparationCountsValid, summaryAvailable:true,
      preparation: {...(evidence?.preparation??{status:'missing',reason:'missing_evidence'}),protocol:'loopback-prepared-v1',ledgerPath:'prepared-gate.jsonl',reconciliation:evidence?.valid&&preparationCountsValid?'complete':'invalid',loginAttempts:prep.attempts,loginSuccesses:prep.successes,loginFailures:prep.failures,protectedReadAttempts:(probe?.passes??0)+(probe?.fails??0),protectedReadSuccesses:probe?.fails??0,protectedReadFailures:probe?.passes??0,summaryAvailable:true}, participation: evidence?.participation ?? null, phaseTiming: evidence?.phaseTiming ?? null,
      evidenceIssues: [...(evidence?.issues??['missing_prepared_evidence']),...(!preparationCountsValid?['invalid_preparation_counters']:[])],
      applicationEvidence: {state:applicationState, completedActionsPerSecond:actions.reduce((n,a)=>n+rows[a].count,0)/config.measurementSeconds, successfulActionsPerSecond:actions.reduce((n,a)=>n+rows[a].successes,0)/config.measurementSeconds,backendRequestsPerSecond:count('http_reqs{traffic:backend,request_phase:measurement}')/config.measurementSeconds,sessionStartsPerSecond:loginMeasurementCount/config.measurementSeconds},
      authenticationEvidence: {
        login: {state:loginMeasurementCount || count('auth_login_attempts{phase:measurement}') ? (loginMeasurementCount < 1000 ? 'insufficient_samples' : 'sufficient_samples') : 'not_exercised', attempts:count('auth_login_attempts{phase:measurement}'), successes:loginMeasurementCount, failures:count('auth_login_failed{phase:measurement}')},
        refresh: {state:measuredRefreshes ? (measuredRefreshes<1000?'insufficient_samples':'sufficient_samples') : 'not_exercised', requests:measuredRefreshes},
        phases,
      },
      traffic: {backendRequests:count('http_reqs{traffic:backend}'), controlRequests:count('http_reqs{traffic:control}'),measuredBackendRequests:count('http_reqs{traffic:backend,request_phase:measurement}'), backendFailureRate:m['http_req_failed{traffic:backend}']?.value ?? null, controlFailureRate:m['http_req_failed{traffic:control}']?.value ?? null},
    } : {}),
    valid: (!prepared || evidence?.valid === true&&preparationCountsValid) && count('users_finished') === config.vus && total > 0 && !count('target_unavailable') && !count('invalid_responses') && mixOk && actions.every(a => rows[a].requested === rows[a].count),
    mixEvidence: mixEnough ? (mixOk ? 'within_5_sigma_sampling_bound' : 'unexpected_distribution') : 'insufficient_samples',
    sloEvidence: applicationState === 'insufficient_samples' || (!prepared && loginMeasurementCount < 1000) ? 'insufficient_samples' : 'exploratory_only',
    loginCount, loginMeasurementCount,
    loginP95Ms: loginMeasurementCount ? loginDuration?.['p(95)'] ?? null : null,
    loginP99Ms: loginMeasurementCount ? loginDuration?.['p(99)'] ?? null : null,
    authFailures: m.auth_failed?.passes ?? 0,
    refreshCount: count('auth_refresh_count'), naturalRefreshObserved: count('auth_refresh_count') > 0,
    accessTokenTtlSeconds: ttl?.count ? { min: ttl.min, max: ttl.max } : null,
    actions: rows,
    limitations: ['No capacity search, repetitions, soak, or load-generator headroom proof.', 'Logical action timers have millisecond resolution.', ...(prepared ? ['Initial authentication is serialized/rate-bounded with no retries; subsequent renewal retains recorded paced attempts.', 'Native token age begins at preparation login; initial active-session age begins at application activation.', ...(evidence?.preparation?.ttlSeconds===null?['Native issued-at/TTL is unavailable; observed expiry/remaining lifetime is checked without inventing a token age.']:[]), 'Control HTTP is reported separately; prerequisites and SDK refresh remain inside logical action latency.'] : ['No automatic retries; prerequisites and SDK refresh are included in logical action latency.'])],
  };
}
