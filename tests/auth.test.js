import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionValid, summarizeAuth } from '../src/auth.js';

const session = () => ({ initial: { iat: 100, exp: 3700 }, final: { iat: 3641, exp: 7241 }, loginAt: 100, endAt: 3730, elapsedSeconds: 3630, firstRefreshAt: 3641, refreshes: 1, reads: 2, postExpiryReads: 1, failures: 0, identityValid: true, loggedOut: true, tokenChanged: true });
test('natural auth evidence requires real elapsed expiry, timely automatic refresh, protected reads and logout', () => {
  assert.equal(sessionValid(session(), 'natural'), true);
  for (const change of [{ elapsedSeconds: 5 }, { endAt: 3699 }, { firstRefreshAt: 3639 }, { refreshes: 0 }, { postExpiryReads: 0 }, { tokenChanged: false }, { identityValid: false }, { loggedOut: false }, { failures: 1 }, { final: { iat: 100, exp: 3700 } }, { initial: { iat: 100, exp: 105 } }, { loginAt: 120 }, { elapsedSeconds: NaN }]) {
    assert.equal(sessionValid({ ...session(), ...change }, 'natural'), false, JSON.stringify(change));
  }
  assert.equal(sessionValid(session(), 'unknown'), false);
});
test('short auth smoke cannot be promoted to natural-expiry evidence', () => {
  const short = { ...session(), final: { iat: 100, exp: 3700 }, endAt: 105, elapsedSeconds: 5, firstRefreshAt: null, refreshes: 0, postExpiryReads: 0, tokenChanged: false };
  assert.equal(sessionValid(short, 'smoke'), true);
  assert.equal(sessionValid(short, 'natural'), false);
});
const summary = () => ({ metrics: Object.fromEntries(Object.entries({ auth_check_finished: { count: 2 }, auth_check_verified: { count: 2 }, auth_check_natural: { count: 2 }, auth_check_logins: { count: 2 }, auth_check_refreshes: { count: 2 }, auth_check_after_expiry: { count: 4 }, auth_check_failed: { value: 0 }, auth_check_ttl: { min: 3600, max: 3600 }, auth_check_elapsed_seconds: { min: 3630, max: 3631 } }).map(([name, value]) => [name, value])) });
test('auth report fails closed on missing/partial/failed evidence and never certifies capacity', () => {
  const result = summarizeAuth(summary(), 2, 'natural');
  assert.equal(result.valid, true); assert.equal(result.naturalExpiryCovered, true); assert.equal(result.certified, false);
  for (const [metric, value] of [['auth_check_verified', { count: 1 }], ['auth_check_logins', { count: 3 }], ['auth_check_failed', { value: 0.1 }], ['auth_check_ttl', { min: 5, max: 5 }], ['auth_check_natural', { count: 0 }]]) {
    const s = summary(); s.metrics[metric] = value; assert.equal(summarizeAuth(s, 2, 'natural').valid, false, metric);
  }
  assert.equal(summarizeAuth({ metrics: {} }, 2, 'natural').valid, false);
  const s = summary(); s.metrics.auth_check_natural.count = 0;
  assert.equal(summarizeAuth(s, 2, 'smoke').naturalExpiryCovered, false);
});
