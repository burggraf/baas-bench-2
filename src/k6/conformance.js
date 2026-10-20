import http from 'k6/http';
import encoding from 'k6/encoding';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import URL from 'core-js-pure/actual/url/index.js';
import URLSearchParams from 'core-js-pure/actual/url-search-params/index.js';
import { initClient } from 'trailbase';
import { createTransport } from './transport.js';
import { conformance } from '../../tests/conformance.js';

globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;
globalThis.atob = value => String.fromCharCode(...new Uint8Array(encoding.b64decode(value, 'std')));

const completed = new Counter('conformance_completed');
export const options = {
  scenarios: { conformance: { executor: 'per-vu-iterations', vus: 2, iterations: 1, maxDuration: '1m' } },
  thresholds: { checks: ['rate==1'], conformance_completed: ['count==2'] },
  // Dynamic URLs contain record IDs; normalized request names replace that tag.
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response', 'error_code'],
};

export default async function () {
  const createClient = () => {
    // k6's default jar is VU-wide: separate jars prevent one SDK client
    // (including the anonymous one) inheriting another client's login cookies.
    const jar = new http.CookieJar();
    const request = (method, url, body, params) => http.asyncRequest(method, url, body, { ...params, jar });
    return initClient(undefined, { transport: createTransport(__ENV.BASE_URL ?? 'http://trailbase:4000', request) });
  };
  const password = `${encoding.b64encode(crypto.randomBytes(24), 'std')}aA1!`;
  // Hex encoding below avoids punctuation forbidden in TrailBase usernames.
  const namespace = `k6${__VU}${Array.from(new Uint8Array(crypto.randomBytes(8)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  await conformance(createClient, namespace, password, (condition, label) => {
    if (!check(condition, { [label]: value => value })) throw new Error(label);
  });
  completed.add(1);
}
