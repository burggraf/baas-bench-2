import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';
import { initClient } from 'trailbase';

const command = (action, expectSuccess = true) => {
  const result = spawnSync('node', ['scripts/social.js', action, 'configs/smoke.json'], { encoding: 'utf8', timeout: 180000 });
  if (expectSuccess) assert.equal(result.status, 0, `${action}: ${result.stdout}\n${result.stderr}`);
  else assert.notEqual(result.status, 0);
  return result;
};

test('API-only fixtures, fresh sessions, real weighted actions, artifacts, single-use baseline and API reset', async () => {
  assert.ok(!existsSync('.fixtures/trailbase.json'), 'Reset the existing benchmark fixture explicitly before this integration test');
  command('prepare');
  try {
    const path = '.fixtures/trailbase.json';
    const fixture = JSON.parse(readFileSync(path));
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(fixture.status, 'ready');
    assert.equal(fixture.baseline.posts, 40);
    assert.equal(fixture.baseline.likes, 40);
    assert.doesNotMatch(JSON.stringify(fixture), /auth_token|refresh_token/);
    command('prepare', false);
    const posts = initClient('http://127.0.0.1:4000').records('posts');
    const first = await posts.list({ pagination: { limit: 20 }, order: ['-created_at', '-id'] });
    assert.equal(first.cursor, undefined, 'TrailBase does not support cursoring custom-ordered feeds');
    const second = await posts.list({ pagination: { limit: 20, offset: 20 }, order: ['-created_at', '-id'] });
    assert.equal(first.records.length + second.records.length, 40);
    assert.equal(new Set([...first.records, ...second.records].map(p => p.id)).size, 40, 'offset pages on the static fixture must not overlap');
    const before = new Set(readdirSync('results'));
    command('run');
    const name = readdirSync('results').find(n => n.startsWith('social-') && !before.has(n));
    assert.ok(name, 'unique artifact directory');
    const report = JSON.parse(readFileSync(`results/${name}/report.json`));
    assert.equal(report.kind, 'fixed-vu-exploratory');
    assert.equal(report.certified, false);
    assert.equal(report.valid, true);
    assert.ok(report.loginCount >= 4, 'initial logins and shortened smoke-session renewals');
    assert.ok(report.end.posts >= report.start.posts && report.end.likes > 0);
    for (const action of Object.keys(fixture.config.weights)) {
      assert.ok(report.actions[action].count > 0, `${action} actually executed`);
      assert.equal(report.actions[action].failures, 0, action);
    }
    const publicArtifacts = ['manifest.json', 'report.json', 'k6-summary.json', 'k6-stdout.log', 'k6-stderr.log'];
    for (const file of publicArtifacts) {
      const text = readFileSync(`results/${name}/${file}`, 'utf8');
      for (const u of fixture.users) assert.ok(!text.includes(u.password), 'password must not enter results');
      assert.doesNotMatch(text, /auth_token|refresh_token/);
    }
    assert.ok(statSync(`results/${name}/k6-metrics.json.gz`).size > 0);
    assert.equal(JSON.parse(readFileSync(path)).status, 'used');
    command('run', false);
    command('reset');
    assert.ok(!existsSync(path));
    // Native public API confirms reset removed all application rows.
    const output = execFileSync('node', ['--input-type=module', '-e', "import { initClient } from 'trailbase'; console.log((await initClient('http://127.0.0.1:4000').records('posts').list({count:true})).total_count)"], { encoding: 'utf8' });
    assert.equal(output.trim(), '0');
  } finally { if (existsSync('.fixtures/trailbase.json')) command('reset'); }
});
