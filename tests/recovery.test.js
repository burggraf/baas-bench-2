import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stopOwnedRunner, recoverOperation } from '../scripts/recovery.js';

async function dockerFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-test-'));
  const original = process.env.PATH;
  const state = { id: 'a'.repeat(64), name: '/social-Ab1234-runner', run: 'social-Ab1234', project: 'baas-bench-2-pilot', service: 'runner', image: 'sha256:expected', running: true };
  writeFileSync(`${directory}/state.json`, JSON.stringify(state));
  writeFileSync(`${directory}/docker`, `#!/usr/bin/env node
const fs=require('node:fs'), p=${JSON.stringify(directory)}, a=process.argv.slice(2), s=JSON.parse(fs.readFileSync(p+'/state.json'));
fs.appendFileSync(p+'/calls.jsonl',JSON.stringify(a)+'\\n');
if(s.daemonError){console.error('daemon unavailable');process.exit(1);}
if(s.absent){console.error('Error: No such object');process.exit(1);}
if(a[0]==='inspect')console.log(JSON.stringify(s));
if(a[0]==='stop'){s.running=false;fs.writeFileSync(p+'/state.json',JSON.stringify(s));}
if(a[0]==='rm'){s.absent=true;fs.writeFileSync(p+'/state.json',JSON.stringify(s));}
`, { mode: 0o700 });
  process.env.PATH = `${directory}:${original}`;
  try { await run(directory, state); }
  finally { process.env.PATH = original; rmSync(directory, { recursive: true }); }
}

test('cleanup stops/removes only an exactly labeled/project/service/image-owned runner by ID', async () => {
  await dockerFixture(async directory => {
    const result = await stopOwnedRunner('social-Ab1234', 'sha256:expected');
    assert.equal(result.status, 'removed');
    const calls = readFileSync(`${directory}/calls.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(a => a[0] === 'stop' && a.at(-1) === 'a'.repeat(64)));
    assert.ok(calls.some(a => a[0] === 'rm' && a.at(-1) === 'a'.repeat(64)));
    assert.ok(!calls.flat().includes('--force'));
  });
});

test('ownership mismatches and daemon errors refuse cleanup; absent is explicit, not any inspection error', async () => {
  for (const patch of [{ run: 'another-run' }, { project: 'other' }, { service: 'backend' }, { image: 'other' }, { name: '/other' }, { daemonError: true }]) {
    await dockerFixture(async (directory, state) => {
      writeFileSync(`${directory}/state.json`, JSON.stringify({ ...state, ...patch }));
      await assert.rejects(stopOwnedRunner('social-Ab1234', 'sha256:expected'));
      assert.ok(readFileSync(`${directory}/calls.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).every(a => a[0] === 'inspect'));
    });
  }
  await dockerFixture(async (directory, state) => {
    writeFileSync(`${directory}/state.json`, JSON.stringify({ ...state, absent: true }));
    assert.equal((await stopOwnedRunner('social-Ab1234', 'sha256:expected')).status, 'absent');
  });
});

test('stale-owner recovery removes only owned resources/lock and leaves credentials byte-for-byte intact', async () => {
  await dockerFixture(async directory => {
    const pid = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
    const credentials = '{"status":"used","password":"unit-test-only"}';
    writeFileSync(`${directory}/fixture.json`, credentials, { mode: 0o600 });
    writeFileSync(`${directory}/operation.lock`, JSON.stringify({ version: 1, pid, command: 'run', runId: 'social-Ab1234', runnerImageId: 'sha256:expected' }), { mode: 0o600 });
    assert.equal((await recoverOperation(directory)).cleanup.status, 'removed');
    assert.equal(readFileSync(`${directory}/fixture.json`, 'utf8'), credentials);
    assert.ok(!existsSync(`${directory}/operation.lock`));
    assert.ok(!existsSync(`${directory}/recovery.lock`));
  });
});

test('legacy/corrupt lock records fail closed and remain available for manual inspection', async () => {
  await dockerFixture(async directory => {
    for (const text of ['', '{"version":2}', '{"version":1,"pid":-1,"command":"run"}']) {
      writeFileSync(`${directory}/operation.lock`, text, { mode: 0o600 });
      await assert.rejects(recoverOperation(directory));
      assert.equal(readFileSync(`${directory}/operation.lock`, 'utf8'), text);
      assert.ok(!existsSync(`${directory}/calls.jsonl`));
      assert.ok(!existsSync(`${directory}/recovery.lock`));
    }
  });
});

test('recovery refuses a live owner without deleting its lock or touching Docker', async () => {
  await dockerFixture(async directory => {
    writeFileSync(`${directory}/operation.lock`, JSON.stringify({ version: 1, pid: process.pid, command: 'run', runId: 'social-Ab1234', runnerImageId: 'sha256:expected' }), { mode: 0o600 });
    await assert.rejects(recoverOperation(directory), /active/);
    assert.ok(existsSync(`${directory}/operation.lock`));
    assert.ok(!existsSync(`${directory}/calls.jsonl`));
  });
});
