import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as baseline from '../scripts/baseline.js';
import { hash } from '../scripts/runtime.js';

for (const failLogs of [false, true]) test(`preparation evidence retains raw backend logs privately and exposes only hashes (${failLogs ? 'failed' : 'successful'} capture)`, async t => {
  assert.equal(typeof baseline.capturePreparationEvidence, 'function');
  const directory = mkdtempSync(join(tmpdir(), 'preparation-evidence-')), original = process.env.PATH;
  t.after(() => { process.env.PATH = original;rmSync(directory, { recursive: true }); });
  const id = 'a'.repeat(64), prefix = join(directory, 'trial-1'), privateDirectory = join(directory, 'private');
  const stdout = 'private-password private-token\n', stderr = 'private-response\n';
  if (process.platform === 'linux') t.mock.method(fs, 'readFile', async path => {
    if (path === '/proc/42/cgroup') return `0::/docker/${id}\n`;
    const files = { 'cpu.stat': 'usage_usec 1\n', 'memory.current': '1024\n', 'memory.peak': '1024\n', 'memory.events': 'max 0\noom 0\noom_kill 0\n' };
    const name = Object.keys(files).find(name => path === `/sys/fs/cgroup/docker/${id}/${name}`);
    assert.ok(name, 'Read only the verified native counter files');return files[name];
  });
  writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node
const op=process.argv[2];
if(op==='logs'){process.stdout.write(${JSON.stringify(stdout)});process.stderr.write(${JSON.stringify(stderr)});process.exit(${failLogs ? 1 : 0});}
if(op==='inspect'){console.log(JSON.stringify({id:${JSON.stringify(id)},pid:42,running:true,oomKilled:false,health:'healthy',restarts:0}));}
if(op==='exec'){if(${process.platform === 'linux'})process.exit(17);console.log('[cpu.stat]\\nusage_usec 1\\n[memory.current]\\n1024\\n[memory.peak]\\n1024\\n[memory.events]\\nmax 0\\noom 0\\noom_kill 0');}
`, { mode: 0o700 });
  process.env.PATH = `${directory}:${original}`;
  if (failLogs) await assert.rejects(baseline.capturePreparationEvidence(prefix, id, privateDirectory), { name: 'PreparationEvidenceError' });
  else await baseline.capturePreparationEvidence(prefix, id, privateDirectory);
  const saved = JSON.parse(readFileSync(`${prefix}.backend-evidence.json`));
  assert.equal(saved.backendId, id);assert.equal(saved.complete, !failLogs);
  assert.deepEqual(saved.failures, failLogs ? ['logs'] : []);
  assert.equal(readFileSync(`${privateDirectory}/stdout.log`, 'utf8'), stdout);
  assert.equal(readFileSync(`${privateDirectory}/stderr.log`, 'utf8'), stderr);
  assert.equal(saved.logs.stdoutHash, hash(`${privateDirectory}/stdout.log`));
  assert.equal(saved.logs.stderrHash, hash(`${privateDirectory}/stderr.log`));
  assert.equal(statSync(privateDirectory).mode & 0o777, 0o700);
  for (const name of ['stdout.log', 'stderr.log']) assert.equal(statSync(`${privateDirectory}/${name}`).mode & 0o777, 0o600);
  assert.ok(saved.cgroups.source.includes('[memory.events]'));assert.equal(saved.inspection.running, true);
  assert.equal(saved.cgroups.capture.method, process.platform === 'linux' ? 'host-cgroup-v2' : 'docker-exec');
  assert.ok(saved.hostMemory.stdout.includes(process.platform === 'linux' ? 'MemAvailable:' : '1'));
  assert.doesNotMatch(JSON.stringify(saved), /private-password|private-token|private-response/);
  await assert.rejects(baseline.capturePreparationEvidence(`${prefix}-bad`, 'not-an-id', `${directory}/invalid`));
});
