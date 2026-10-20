import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { initClient } from 'trailbase';

const command = action => {
  const r = spawnSync('node', ['scripts/social.js', action, 'configs/smoke.json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `${action}: ${r.stdout}\n${r.stderr}`);
  return r;
};
test('separate SDK auth smoke is single-use, read-only, private and never claims natural expiry', { timeout: 150000 }, async () => {
  assert.ok(!existsSync('.fixtures/trailbase.json'), 'Explicitly reset an existing fixture first');
  command('prepare');
  const fixture = JSON.parse(readFileSync('.fixtures/trailbase.json'));
  try {
    const before = new Set(readdirSync('results'));
    command('auth-smoke');
    const name = readdirSync('results').find(n => n.startsWith('social-') && !before.has(n));
    assert.ok(name);
    const report = JSON.parse(readFileSync(`results/${name}/report.json`));
    assert.equal(report.kind, 'native-sdk-auth-correctness');
    assert.equal(report.mode, 'smoke'); assert.equal(report.valid, true);
    assert.equal(report.certified, false); assert.equal(report.naturalExpiryCovered, false);
    assert.equal(report.logins, 2); assert.equal(report.successfulRefreshes, 0);
    const points = gunzipSync(readFileSync(`results/${name}/k6-metrics.json.gz`)).toString().trim().split('\n').map(JSON.parse)
      .filter(row => row.type === 'Point' && row.metric === 'auth_check_session');
    assert.equal(new Set(points.map(row => row.data.tags.vu)).size, 2, 'independently auditable numeric evidence for each VU');
    for (const vu of ['1', '2']) {
      const values = Object.fromEntries(points.filter(row => row.data.tags.vu === vu).map(row => [row.data.tags.field, row.data.value]));
      assert.equal(values.initial_exp - values.initial_iat, 3600);
      assert.equal(values.final_exp - values.final_iat, 3600);
      assert.equal(values.refreshes, 0); assert.equal(values.firstRefreshAt, -1);
      assert.equal(values.identityValid, 1); assert.equal(values.loggedOut, 1); assert.equal(values.failures, 0);
      assert.ok(values.elapsedSeconds >= 5);
    }
    assert.equal(report.tokenTtlSeconds.min, 3600); assert.equal(report.tokenTtlSeconds.max, 3600);
    assert.equal(report.resources.valid, true); assert.equal(report.end.posts, report.start.posts); assert.equal(report.end.likes, report.start.likes);
    assert.equal(JSON.parse(readFileSync('.fixtures/trailbase.json')).status, 'used');
    assert.notEqual(spawnSync('node', ['scripts/social.js', 'auth-smoke', 'configs/smoke.json'], { stdio: 'ignore' }).status, 0);
    for (const file of readdirSync(`results/${name}`)) {
      const buffer = readFileSync(`results/${name}/${file}`);
      const text = (file.endsWith('.gz') ? gunzipSync(buffer) : buffer).toString();
      assert.doesNotMatch(text, /auth_token|refresh_token|"password"/);
      for (const user of fixture.users) assert.ok(!text.includes(user.password), `${file}: private password`);
    }
  } finally { command('reset'); }
  assert.equal((await initClient('http://127.0.0.1:4000').records('posts').list({ count: true })).total_count, 0);
});
