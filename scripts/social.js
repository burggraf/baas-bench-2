import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, lstatSync } from 'node:fs';
import { controllerClient } from './client.js';
import { validateConfig } from '../src/workload.js';
import { seedFixture, verifyFixture, deleteFixture, savePrivate } from '../src/fixtures.js';
import { capture, runtimeManifest } from './runtime.js';
import { recoverOperation } from './recovery.js';
import { runWorkload } from './workload-run.js';

const [command, configPath = 'configs/pilot-small.json', ...extra] = process.argv.slice(2);
const authCheck = ['auth', 'auth-smoke'].includes(command);
const authMode = command === 'auth' ? 'natural' : 'smoke';
const path = '.fixtures/trailbase.json';
let lock, directory, loadedFixture, interrupted;
let retainLock = false;
const cancellation = new AbortController();
const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
  interrupted ??= signal;
  cancellation.abort();
}]));
for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
const createClient = () => controllerClient(cancellation.signal);
const json = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2));

try {
  assert.ok(['prepare', 'run', 'auth', 'auth-smoke', 'reset', 'recover'].includes(command) && !extra.length, 'Usage: node scripts/social.js prepare|run|auth|auth-smoke|reset|recover [config.json]');
  const config = validateConfig(JSON.parse(readFileSync(configPath)));
  assert.equal(config.version,'social-mixed-v1','Prepared sessions require fresh bounded controllers: baseline or pocketbase --prepared-sessions');
  mkdirSync('.fixtures', { recursive: true, mode: 0o700 });
  const parent = lstatSync('.fixtures');
  assert.ok(parent.isDirectory() && !parent.isSymbolicLink() && !(parent.mode & 0o077), 'Use a private .fixtures directory (0700)');
  if (command === 'recover') {
    const recovery = await recoverOperation();
    mkdirSync('results', { recursive: true });
    json(`${mkdtempSync('results/recovery-')}/recovery.json`, recovery);
    console.log('Recovered stale operation resources/lock; credentials and application data were not changed. Explicit reset/reseed is still required.');
  } else {
  assert.ok(!existsSync('.fixtures/recovery.lock'), 'Recovery is active or stale: inspect before another operation');
  lock = openSync('.fixtures/operation.lock', 'wx', 0o600);
  const operation = { version: 1, pid: process.pid, command: authCheck ? 'run' : command, ...(authCheck ? { kind: 'native-sdk-auth-correctness', mode: authMode } : {}), startedAt: new Date().toISOString() };
  writeFileSync(lock, JSON.stringify(operation));
  const runtime = runtimeManifest(['package-lock.json', 'compose.yaml', 'backends/trailbase/Dockerfile', 'backends/trailbase/configuration/config.textproto', 'backends/trailbase/configuration/migrations/main/U1792454400__social_schema.sql', 'src/fixtures.js', 'src/workload.js', 'src/actions.js', 'src/report.js', 'src/resources.js', 'src/auth.js', 'src/k6/auth.js', 'src/k6/transport.js', 'src/base64.js', 'scripts/build.js', 'scripts/social.js', 'scripts/workload-run.js', 'scripts/client.js', 'scripts/runtime.js', 'scripts/monitor.js', 'scripts/recovery.js', configPath]);
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
    const fixture = loadedFixture = JSON.parse(readFileSync(path));
    assert.equal(fixture.volume, volume.Name, 'Fixture deployment mismatch');
    assert.deepEqual(fixture.config, config, 'Use the fixture configuration; reset before changing it');
    if (command === 'reset') {
      await deleteFixture(fixture, createClient, value => savePrivate(path, value));
      unlinkSync(path);
      console.log('Deleted benchmark accounts/application rows through native APIs; private fixture removed.');
    } else {
      assert.equal(fixture.status, 'ready', 'Baseline is partial/used: reset/reseed before every trial');
      const baseline = await verifyFixture(config, fixture, createClient);
      mkdirSync('results', { recursive: true });
      directory = mkdtempSync('results/social-');
      await runWorkload({ directory, config, configPath, fixture, baseline, runtime, operation, signal: cancellation.signal, interruption: () => interrupted, authMode: authCheck ? authMode : null });
    }
  }
  }
} catch (error) {
  retainLock ||= error.retainLock === true;
  // Never serialize a server response, private fixture, or SDK error object into public artifacts.
  const failure = { stage: command, type: error.name, httpStatus: error.status ?? null };
  if (directory) json(`${directory}/failure.json`, failure);
  if (error.code === 'ERR_ASSERTION' || error.message?.startsWith('Invalid config:')) console.error(error.message.split('\n')[0]);
  console.error(`Pilot ${command ?? 'command'} failed (${failure.type}, HTTP ${failure.httpStatus ?? 'n/a'}). Check configuration, private fixture state, and saved run evidence. No automatic reset/retry was performed.`);
  process.exitCode = 1;
} finally {
  if (interrupted) {
    if ((command === 'run' || authCheck) && loadedFixture?.status === 'ready') { loadedFixture.status = 'used'; savePrivate(path, loadedFixture); }
    if (directory) json(`${directory}/interruption.json`, { signal: interrupted, at: new Date().toISOString(), valid: false });
    process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  }
  if (lock !== undefined) { closeSync(lock); if (!retainLock) unlinkSync('.fixtures/operation.lock'); }
  for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
}
