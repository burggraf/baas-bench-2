import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runRunner } from '../scripts/runtime.js';

test('runner is asynchronous and retains complete stdout/stderr/exit artifacts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-test-'));
  const original = process.env.PATH;
  writeFileSync(join(directory, 'docker'), '#!/usr/bin/env node\nconsole.log("output"); console.error("diagnostic"); setTimeout(()=>process.exit(0),250);', { mode: 0o700 });
  process.env.PATH = `${directory}:${original}`;
  let ticked = false;
  const timer = setTimeout(() => { ticked = true; }, 50);
  try {
    const status = await runRunner(directory, 'probe', ['unused']);
    assert.equal(ticked, true, 'synchronous spawning prevents signal handlers and cleanup');
    assert.equal(status, 0);
    assert.equal(readFileSync(`${directory}/probe-stdout.log`, 'utf8'), 'output\n');
    assert.equal(readFileSync(`${directory}/probe-stderr.log`, 'utf8'), 'diagnostic\n');
    assert.equal(JSON.parse(readFileSync(`${directory}/probe-exit.json`)).status, 0);
  } finally { clearTimeout(timer); process.env.PATH = original; rmSync(directory, { recursive: true }); }
});

test('in-flight abort terminates an uncooperative Docker client and records its exit', { timeout: 6000 }, async context => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-stop-'));
  const original = process.env.PATH;
  writeFileSync(join(directory, 'docker'), `#!/usr/bin/env node\nprocess.on('SIGTERM',()=>{});console.log('ready');require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'ready'))},'');setInterval(()=>{},1000);`, { mode: 0o700 });
  process.env.PATH = `${directory}:${original}`;
  const abort = new AbortController();
  const watcher = watch(directory, (_, file) => { if (file === 'ready') abort.abort(); });
  try {
    await runRunner(directory, 'probe', ['unused'], [], { signal: AbortSignal.any([abort.signal, context.signal]) });
    assert.equal(JSON.parse(readFileSync(`${directory}/probe-exit.json`)).signal, 'SIGKILL');
    assert.match(readFileSync(`${directory}/probe-stdout.log`, 'utf8'), /ready/);
  } finally { watcher.close(); process.env.PATH = original; rmSync(directory, { recursive: true }); }
});

test('aborted runner launch is refused before starting a Docker client', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-abort-'));
  const original = process.env.PATH;
  writeFileSync(join(directory, 'docker'), '#!/usr/bin/env node\nprocess.exit(0);', { mode: 0o700 });
  process.env.PATH = `${directory}:${original}`;
  try {
    await assert.rejects(async () => runRunner(directory, 'probe', ['unused'], [], { signal: AbortSignal.abort() }), { name: 'AbortError' });
  } finally { process.env.PATH = original; rmSync(directory, { recursive: true }); }
});
