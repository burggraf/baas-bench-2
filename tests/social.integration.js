import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runRunner } from '../scripts/runtime.js';
import test from 'node:test';
import { initClient } from 'trailbase';

const command = (action, expectSuccess = true) => {
  const result = spawnSync('node', ['scripts/social.js', action, 'configs/smoke.json'], { encoding: 'utf8', timeout: 180000 });
  if (expectSuccess) assert.equal(result.status, 0, `${action}: ${result.stdout}\n${result.stderr}`);
  else assert.notEqual(result.status, 0);
  return result;
};

test('pinned k6 reports completed threshold failures as exit 99, not a crash', async () => {
  const directory = mkdtempSync('results/threshold-exit-');
  writeFileSync(`${directory}/probe.js`, "import {Counter} from 'k6/metrics'; const probe = new Counter('probe'); export const options = {vus:1, iterations:1, thresholds:{probe:['count>1']}}; export default function () {probe.add(1);}");
  assert.equal(await runRunner(directory, 'probe', ['k6', 'run', '/probe.js'], ['-v', `${resolve(directory)}/probe.js:/probe.js:ro`]), 99);
});

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
    assert.equal(report.workloadValid, true);
    assert.equal(report.resources.valid, true);
    assert.equal(report.resources.generatorHeadroom, 'unverified');
    assert.equal(report.resources.containers.runner.last.status, 'exited');
    assert.equal(report.resources.containers.runner.last.exitCode, 0);
    const samples = readFileSync(`results/${name}/resources.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    for (const role of ['backend', 'runner']) {
      assert.ok(samples.filter(r => r.role === role && r.type === 'stats').length >= 2);
      assert.ok(samples.filter(r => r.role === role && r.type === 'cgroup').length >= 2);
    }
    assert.ok(samples.every(r => Number.isFinite(Date.parse(r.at)) && r.elapsedMs >= 0));
    const runnerId = report.resources.containers.runner.last.id;
    assert.notEqual(spawnSync('docker', ['inspect', runnerId], { stdio: 'ignore' }).status, 0, 'only the owned retained runner is removed after final inspection');
    assert.ok(report.loginCount >= 4, 'initial logins and shortened smoke-session renewals');
    assert.ok(report.end.posts >= report.start.posts && report.end.likes > 0);
    for (const action of Object.keys(fixture.config.weights)) {
      assert.ok(report.actions[action].count > 0, `${action} actually executed`);
      assert.equal(report.actions[action].failures, 0, action);
    }
    const publicArtifacts = ['manifest.json', 'report.json', 'k6-summary.json', 'k6-stdout.log', 'k6-stderr.log', 'resources.jsonl', 'resources-summary.json', 'monitor-stderr.log', 'backend-docker-stats.log', 'runner-docker-stats.log', 'docker-stats-stderr.log', 'inspect-stderr.log', 'cgroup-stderr.log'];
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

const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 20000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
const running = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

for (const signal of ['SIGINT', 'SIGTERM', 'SIGKILL']) {
  test(`${signal}: interrupted controller preserves a used baseline and cleans only its owned runner`, { timeout: 60000 }, async () => {
    assert.ok(!existsSync('.fixtures/trailbase.json'));
    command('prepare');
    const directory = mkdtempSync('results/interruption-test-');
    const out = openSync(`${directory}/stdout.log`, 'w'), err = openSync(`${directory}/stderr.log`, 'w');
    const child = spawn(process.execPath, ['scripts/social.js', 'run', 'configs/smoke.json'], { stdio: ['ignore', out, err] });
    const ended = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    let operation;
    try {
      await waitFor(() => {
        if (!existsSync('.fixtures/operation.lock')) return false;
        try {
          operation = JSON.parse(readFileSync('.fixtures/operation.lock'));
          if (!operation.runId || !operation.monitorPid) return false;
          const file = `results/${operation.runId}/resources.jsonl`;
          if (!existsSync(file)) return false;
          const rows = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
          const started = rows.find(r => r.type === 'lifecycle' && r.role === 'runner' && r.source.running);
          return rows.filter(r => r.type === 'stats' && r.role === 'runner').length >= 2 && started && rows.at(-1).elapsedMs - started.elapsedMs >= 6000;
        } catch { return false; }
      }, 'controller must reach an actively sampled real k6 workload');
      child.kill(signal);
      const exit = await ended;
      assert.equal(JSON.parse(readFileSync('.fixtures/trailbase.json')).status, 'used');
      await waitFor(() => !running(operation.monitorPid), 'monitor must terminate after shutdown/parent loss');
      if (signal === 'SIGKILL') {
        assert.equal(exit.signal, 'SIGKILL');
        assert.ok(existsSync('.fixtures/operation.lock'), 'uncatchable death leaves an explicit recovery lock');
        command('reset', false);
        const credentials = readFileSync('.fixtures/trailbase.json', 'utf8');
        command('recover');
        assert.equal(readFileSync('.fixtures/trailbase.json', 'utf8'), credentials, 'recovery must not delete accounts or alter credentials');
      } else {
        assert.equal(exit.code, signal === 'SIGINT' ? 130 : 143);
        assert.equal(JSON.parse(readFileSync(`results/${operation.runId}/interruption.json`)).signal, signal);
      }
      assert.ok(!existsSync('.fixtures/operation.lock'));
      const reportPath = `results/${operation.runId}/report.json`;
      if (existsSync(reportPath)) {
        const report = JSON.parse(readFileSync(reportPath));
        assert.equal(report.valid, false, 'interruption is never valid evidence, even if k6 exits cleanly');
        assert.ok(Object.values(report.actions).some(action => action.count > 0), 'interrupt after real measurement-phase actions, not only startup');
      }
      const fixture = JSON.parse(readFileSync('.fixtures/trailbase.json'));
      for (const file of readdirSync(`results/${operation.runId}`).filter(f => /\.(json|jsonl|log|md)$/.test(f))) {
        const text = readFileSync(`results/${operation.runId}/${file}`, 'utf8');
        for (const user of fixture.users) assert.ok(!text.includes(user.password), 'interrupted artifacts must not expose passwords');
        assert.doesNotMatch(text, /auth_token|refresh_token/);
      }
      assert.notEqual(spawnSync('docker', ['inspect', `${operation.runId}-runner`], { stdio: 'ignore' }).status, 0);
      command('run', false);
      command('reset');
      assert.equal((await initClient('http://127.0.0.1:4000').records('posts').list({ count: true })).total_count, 0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await ended; }
      closeSync(out); closeSync(err);
      if (existsSync('.fixtures/trailbase.json') && !existsSync('.fixtures/operation.lock')) command('reset');
    }
  });
}

test('SIGTERM during API preparation retains a failed private fixture and releases the operation lock', { timeout: 30000 }, async () => {
  assert.ok(!existsSync('.fixtures/trailbase.json'));
  const directory = mkdtempSync('results/prepare-interruption-');
  const out = openSync(`${directory}/stdout.log`, 'w'), err = openSync(`${directory}/stderr.log`, 'w');
  let child, sent = false;
  const watcher = watch('.fixtures', (_, file) => {
    if (sent || file !== 'trailbase.json') return;
    try { if (JSON.parse(readFileSync('.fixtures/trailbase.json')).status === 'pending') { sent = true; child.kill('SIGTERM'); } }
    catch { /* Wait for the initial private write to finish. */ }
  });
  child = spawn(process.execPath, ['scripts/social.js', 'prepare', 'configs/smoke.json'], { stdio: ['ignore', out, err] });
  const ended = new Promise(resolve => child.once('close', code => resolve(code)));
  try {
    assert.equal(await ended, 143);
    assert.equal(sent, true);
    assert.equal(JSON.parse(readFileSync('.fixtures/trailbase.json')).status, 'failed');
    assert.equal(statSync('.fixtures/trailbase.json').mode & 0o777, 0o600);
    assert.ok(!existsSync('.fixtures/operation.lock'));
    command('run', false);
    command('reset', false);
  } finally {
    watcher.close();
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await ended; }
    closeSync(out); closeSync(err);
    // This test owns the newly generated namespace; explicit SDK cleanup is not partial-seed resume.
    if (existsSync('.fixtures/trailbase.json')) {
      const fixture = JSON.parse(readFileSync('.fixtures/trailbase.json'));
      for (const [i, user] of fixture.users.entries()) {
        assert.equal(user.username, `${fixture.namespace}${i}`);
        const client = initClient('http://127.0.0.1:4000');
        try {
          try { await client.login(user.username, user.password); }
          catch (error) { if (error.status === 401) continue; throw error; }
          assert.equal(client.user()?.username, user.username);
          await client.deleteUser();
        } finally { if (client.user()) await client.logout(); }
      }
      assert.equal((await initClient('http://127.0.0.1:4000').records('posts').list({ count: true })).total_count, 0);
      unlinkSync('.fixtures/trailbase.json');
    }
  }
});
