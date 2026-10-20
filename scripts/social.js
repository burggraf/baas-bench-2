import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { initClient } from 'trailbase';
import { validateConfig } from '../src/workload.js';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';
import { summarize } from '../src/report.js';
import { capture, hash, runtimeManifest, runRunner } from './runtime.js';

const [command, configPath = 'configs/pilot-small.json', ...extra] = process.argv.slice(2);
const path = '.fixtures/trailbase.json';
let lock, directory;
// Fixed local pilot origin: remote or arbitrary targets require a separate deployment contract.
const createClient = () => {
  let logoutFailed = false;
  const client = initClient(undefined, { transport: { async fetch(path, init) {
    try {
      const response = await fetch(new URL(path, 'http://127.0.0.1:4000'), { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (path.endsWith('/logout') && !response.ok) logoutFailed = true;
      return response;
    } catch (error) { if (path.endsWith('/logout')) logoutFailed = true; throw error; }
  } } });
  const logout = client.logout.bind(client);
  client.logout = async () => { logoutFailed = false; await logout(); if (logoutFailed) throw new Error('Native logout failed'); return true; };
  return client;
};
const json = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2));

async function endCounts(fixture) {
  let posts = 0, likes = 0;
  for (const user of fixture.users) {
    const client = createClient();
    try {
      await client.login(user.username, user.password);
      assert.equal(client.user()?.id, user.id, 'End verification identity mismatch');
      posts += (await client.records('posts').list({ pagination: { limit: 1 }, filters: [{ column: 'author', value: user.id }], count: true })).total_count;
      likes += (await client.records('likes').list({ pagination: { limit: 1 }, count: true })).total_count;
    } finally { if (client.user()) await client.logout(); }
  }
  return { users: fixture.users.length, posts, likes };
}
const storageBytes = () => Number(capture('docker', ['compose', 'exec', '-T', 'trailbase', 'du', '-sk', '/app/traildepot']).split(/\s+/)[0]) * 1024;

try {
  assert.ok(['prepare', 'run', 'reset'].includes(command) && !extra.length, 'Usage: node scripts/social.js prepare|run|reset [config.json]');
  const config = validateConfig(JSON.parse(readFileSync(configPath)));
  mkdirSync('.fixtures', { recursive: true, mode: 0o700 });
  const parent = lstatSync('.fixtures');
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && !(parent.mode & 0o077), 'Use a private .fixtures directory (0700)');
  lock = openSync('.fixtures/operation.lock', 'wx', 0o600);
  const runtime = runtimeManifest(['package-lock.json', 'compose.yaml', 'backends/trailbase/Dockerfile', 'backends/trailbase/configuration/config.textproto', 'backends/trailbase/configuration/migrations/main/U1792454400__social_schema.sql', 'src/fixtures.js', 'src/workload.js', 'src/actions.js', 'src/report.js', 'scripts/social.js', 'scripts/runtime.js', configPath]);
  const volume = JSON.parse(capture('docker', ['inspect', capture('docker', ['compose', 'ps', '-q', 'trailbase'])]))[0].Mounts.find(m => m.Destination === '/app/traildepot');
  assert.equal(volume?.Name, 'baas-bench-2-pilot_trailbase-data', 'Refuse non-pilot deployment');
  if (command === 'prepare') {
    assert.ok(!existsSync(path), 'Fixture already exists: explicitly reset/reseed; never overwrite credentials');
    let initial = true;
    const fixture = await seedFixture(config, createClient, value => { savePrivate(path, { ...value, volume: volume.Name, preparation: runtime }, initial); initial = false; });
    console.log(`Prepared ${fixture.baseline.users} users, ${fixture.baseline.posts} posts, ${fixture.baseline.likes} likes in ${fixture.seedSeconds.toFixed(2)}s. Credentials remain private; no tokens saved.`);
  } else {
    const file = lstatSync(path);
    assert.ok(file.isFile() && !file.isSymbolicLink() && !(file.mode & 0o077), 'Fixture must be a private regular file (0600)');
    const fixture = JSON.parse(readFileSync(path));
    assert.equal(fixture.volume, volume.Name, 'Fixture deployment mismatch');
    assert.deepEqual(fixture.config, config, 'Use the fixture configuration; reset before changing it');
    if (command === 'reset') {
      await deleteFixture(fixture, createClient, value => savePrivate(path, value));
      unlinkSync(path);
      console.log('Deleted benchmark accounts/application rows through native APIs; private fixture removed.');
    } else {
      assert.equal(fixture.status, 'ready', 'Baseline is partial/used: reset/reseed before every trial');
      const baseline = await verifyFixture(config, fixture, createClient);
      capture('npm', ['run', 'build']);
      mkdirSync('results', { recursive: true });
      directory = mkdtempSync('results/social-');
      const id = directory.split('/').at(-1);
      const start = { ...baseline, storageBytes: storageBytes() };
      json(`${directory}/manifest.json`, { kind: 'fixed-vu-exploratory', ...runtime, config, hashes: { ...runtime.hashes, 'dist/social.js': hash('dist/social.js') }, fixtureHash: hash(path), seedSeconds: fixture.seedSeconds, preparation: fixture.preparation, baseline });
      json(`${directory}/fixtures.json`, { recipe: config.dataset, seed: config.seed, baseline, fixtureHash: hash(path) });
      json(`${directory}/config.json`, config);
      // Consume before launching: crashes/failed runs must never silently reuse a mutated baseline.
      fixture.status = 'used'; savePrivate(path, fixture);
      const out = openSync(`${directory}/backend-stats.jsonl`, 'w'), err = openSync(`${directory}/backend-stats-stderr.log`, 'w');
      const backendId = capture('docker', ['compose', 'ps', '-q', 'trailbase']);
      const stats = spawn('docker', ['stats', '--format', '{{json .}}', backendId], { stdio: ['ignore', out, err] });
      const statsEnded = new Promise(resolve => { stats.once('exit', resolve); stats.once('error', resolve); });
      let status;
      try {
        status = runRunner(directory, 'k6', ['k6', 'run', '--out', `json=/results/${id}/k6-metrics.json.gz`, '--summary-export', `/results/${id}/k6-summary.json`, '/scripts/social.js'], ['-v', `${resolve(path)}:/private/fixture.json:ro`, '-v', `${resolve(configPath)}:/config/run.json:ro`]);
      } finally { stats.kill('SIGTERM'); await statsEnded; closeSync(out); closeSync(err); }
      const summary = JSON.parse(readFileSync(`${directory}/k6-summary.json`));
      const report = { ...summarize(summary, config), exitStatus: status, start, end: { ...await endCounts(fixture), storageBytes: storageBytes() } };
      json(`${directory}/report.json`, report);
      const lines = ['# Exploratory fixed-VU smoke report', '', '**Not a capacity result.**', '', `Dataset: ${config.dataset.profile}; VUs: ${config.vus}; measurement: ${config.measurementSeconds}s.`, `Workload validity: ${report.valid}; sample evidence: ${report.sloEvidence}; k6 exit: ${status}.`, '', '| Action | Completed | Failed | Observed % | p95 ms | SLO evidence |', '|---|---:|---:|---:|---:|---|', ...Object.entries(report.actions).map(([name, a]) => `| ${name} | ${a.count} | ${a.failures} | ${a.observedPercent.toFixed(2)} | ${a.p95Ms ?? 'n/a'} | ${a.slo} |`), '', `Posts: ${report.start.posts} -> ${report.end.posts}; likes: ${report.start.likes} -> ${report.end.likes}.`, '', ...report.limitations.map(l => `- ${l}`), '- Backend Docker stats retained; generator headroom and natural token expiry not certified.'];
      writeFileSync(`${directory}/report.md`, lines.join('\n') + '\n');
      console.log(`Workload evidence: ${directory}; insufficient samples are not SLO passes.`);
      assert.equal(status, 0, 'k6 thresholds/execution failed; original evidence retained');
      assert.ok(report.valid, 'Workload validity failed; inspect report and raw metrics');
    }
  }
} catch (error) {
  // Never serialize a server response, private fixture, or SDK error object into public artifacts.
  const failure = { stage: command, type: error.name, httpStatus: error.status ?? null };
  if (directory) json(`${directory}/failure.json`, failure);
  if (error.code === 'ERR_ASSERTION' || error.message?.startsWith('Invalid config:')) console.error(error.message.split('\n')[0]);
  console.error(`Pilot ${command ?? 'command'} failed (${failure.type}, HTTP ${failure.httpStatus ?? 'n/a'}). Check configuration, private fixture state, and saved run evidence. No automatic reset/retry was performed.`);
  process.exitCode = 1;
} finally {
  if (lock !== undefined) { closeSync(lock); unlinkSync('.fixtures/operation.lock'); }
}
