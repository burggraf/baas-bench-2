// Numeric/boolean evidence only: tokens and native identities never leave the VU.
export function sessionValid(s, mode) {
  const claims = c => c && Number.isSafeInteger(c.iat) && Number.isSafeInteger(c.exp) && c.exp - c.iat === 3600;
  if (!['natural', 'smoke'].includes(mode) || !claims(s.initial) || !claims(s.final) ||
      ![s.loginAt, s.endAt, s.elapsedSeconds, s.refreshes, s.reads, s.postExpiryReads].every(Number.isFinite) ||
      Math.abs(s.loginAt - s.initial.iat) > 5 || s.elapsedSeconds < 5 || s.endAt < s.loginAt ||
      s.reads < 1 || s.failures !== 0 || s.identityValid !== true || s.loggedOut !== true) return false;
  return mode === 'smoke' || (s.endAt > s.initial.exp && s.elapsedSeconds > s.initial.exp - s.loginAt &&
    s.refreshes >= 1 && s.postExpiryReads >= 1 && s.tokenChanged === true && s.final.exp > s.initial.exp &&
    Number.isFinite(s.firstRefreshAt) && s.firstRefreshAt >= s.initial.exp - 60 && s.firstRefreshAt <= s.endAt);
}

export function summarizeAuth(summary, vus, mode) {
  const m = summary.metrics ?? {}, count = name => m[`auth_check_${name}`]?.count;
  const ttl = m.auth_check_ttl, elapsed = m.auth_check_elapsed_seconds;
  const valid = ['smoke', 'natural'].includes(mode) && Number.isSafeInteger(vus) && vus > 0 &&
    count('finished') === vus && count('verified') === vus && count('logins') === vus &&
    m.auth_check_failed?.value === 0 && ttl?.min === 3600 && ttl?.max === 3600 &&
    Number.isFinite(elapsed?.min) && elapsed.min >= 5 && Number.isFinite(elapsed?.max) && elapsed.max >= elapsed.min &&
    (mode === 'smoke' || (count('natural') === vus && count('refreshes') >= vus && count('after_expiry') >= vus && elapsed.min > 3595));
  return { kind: 'native-sdk-auth-correctness', mode, valid, certified: false,
    naturalExpiryCovered: valid && mode === 'natural', users: vus,
    logins: count('logins') ?? null, successfulRefreshes: count('refreshes') ?? null,
    protectedReadsAfterOriginalExpiry: count('after_expiry') ?? null,
    tokenTtlSeconds: ttl ? { min: ttl.min, max: ttl.max } : null,
    elapsedSeconds: elapsed ? { min: elapsed.min, max: elapsed.max } : null,
    limitations: ['Separate authentication correctness check, not the weighted workload or a capacity/SLO/soak result.',
      ...(mode === 'smoke' ? ['Short smoke does not cover natural token expiry.'] : [])] };
}
