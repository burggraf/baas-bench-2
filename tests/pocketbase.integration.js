import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync, watch } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { capture, hash } from '../scripts/runtime.js';
import { summarizeResources } from '../src/resources.js';
import { savePrivate } from '../src/fixtures.js';

const read = path => JSON.parse(readFileSync(path));
async function smoke(interrupt = false) {
  assert.equal(existsSync('.fixtures/pocketbase.json'), false);
  const before = existsSync('.fixtures/trailbase.json') ? hash('.fixtures/trailbase.json') : null;
  const logs = mkdtempSync('results/pocketbase-native-');
  const child = spawn(process.execPath, ['scripts/pocketbase.js', '--smoke'], { stdio: ['ignore','pipe','pipe'] });
  let stdout = '', signalled = false, credentials = [], workload;
  const event = watch('.fixtures', () => {
    try {
      const fixture = read('.fixtures/pocketbase.json');
      if (fixture.users?.length) credentials = fixture.users;
      const operation = read('.fixtures/operation.lock'); workload = operation.workloadDirectory;
    } catch {}
  });
  const observer = interrupt ? watch('results', { recursive: true }, (_, name) => {
    if (!signalled && workload && name === `${workload.slice('results/'.length)}/resources.jsonl`) {
      try {
        const rows = readFileSync(`${workload}/resources.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
        if (rows.some(row => row.role === 'runner' && row.type === 'lifecycle' && row.source.running)) { signalled = true; child.kill('SIGTERM'); }
      } catch {}
    }
  }) : null;
  child.stdout.on('data', data => { stdout += data; appendFileSync(`${logs}/stdout.log`, data); });
  child.stderr.on('data', data => appendFileSync(`${logs}/stderr.log`, data));
  const timer = setTimeout(() => child.kill('SIGTERM'), 150000);
  let exit;
  try { exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code,signal})); }); }
  finally { clearTimeout(timer); event.close(); observer?.close(); }
  assert.equal(before, existsSync('.fixtures/trailbase.json') ? hash('.fixtures/trailbase.json') : null);
  const directory = stdout.match(/PocketBase evidence: (results\/pocketbase-[A-Za-z0-9]{6});/)?.[1];
  assert.ok(directory, `Missing result pointer; inspect ${logs}`);
  assert.equal(exit.code, interrupt ? 1 : 0, `Inspect ${logs} and ${directory}`);
  const summary = read(`${directory}/summary.json`);
  assert.equal(summary.certified, false);
  assert.equal(existsSync('.fixtures/operation.lock'), false);
  assert.equal(capture('docker', ['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']), '');
  assert.equal(capture('docker', ['network','ls','-q','--filter','label=com.docker.compose.project=baas-bench-2-pilot']), '');
  const scan = dir => {
    for (const entry of readdirSync(dir, {withFileTypes:true})) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { scan(path); continue; }
      const bytes = readFileSync(path), text = (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString();
      for (const user of credentials) assert.ok(!text.includes(user.password), `Credential leak: ${path}`);
      assert.doesNotMatch(text, /"password"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, path);
    }
  };
  assert.equal(credentials.length, 4);
  scan(directory); if (workload) scan(workload);
  if (interrupt) {
    assert.equal(signalled, true); assert.equal(summary.completed, false);
    const fixture = read('.fixtures/pocketbase.json'); assert.equal(fixture.status, 'used');
    assert.match(fixture.volume, new RegExp(`${directory.split('/').at(-1)}-1$`));
    assert.equal(statSync('.fixtures/pocketbase.json').mode & 0o777, 0o600);
    const archive = `.fixtures/archive/${directory.split('/').at(-1)}-interrupted.json`;
    savePrivate(archive, fixture, true); assert.equal(hash(archive), hash('.fixtures/pocketbase.json'));
    // Release only this test's canonical filename after a byte-identical private archive; retain its database/accounts.
    unlinkSync('.fixtures/pocketbase.json');
  } else {
    assert.equal(summary.completed, true); assert.equal(summary.history[0].verdict, 'pass');
    assert.equal(read(`${directory}/point-2/conformance.json`).passed, true);
    const workloadDirectory = summary.history[0].workloadDirectory, report = read(`${workloadDirectory}/report.json`);
    assert.equal(report.valid, true); assert.equal(report.start.posts, 40); assert.equal(report.start.likes, 40);
    for (const action of Object.values(report.actions)) { assert.ok(action.count > 0); assert.equal(action.failures, 0); }
    assert.deepEqual(report.resources, summarizeResources(readFileSync(`${workloadDirectory}/resources.jsonl`, 'utf8').trim().split('\n').map(JSON.parse)));
    assert.equal(report.resources.containers.backend.first.nanoCpus, 1e9); assert.equal(report.resources.containers.backend.first.memoryLimit, 4294967296);
    assert.equal(report.resources.containers.runner.first.nanoCpus, 4e9); assert.equal(report.resources.containers.runner.first.memoryLimit, 17179869184);
    assert.equal(read(`${directory}/point-2/cleanup.json`).apiPosts, 0);
    assert.equal(existsSync('.fixtures/pocketbase.json'), false);
  }
}
test('PocketBase native SDK/ACL/fixture/weighted k6 smoke passes with unchanged limits and private-free evidence', {timeout:180000}, () => smoke());
test('PocketBase SIGTERM retains only its used fixture/database and removes owned resources', {timeout:180000}, () => smoke(true));
