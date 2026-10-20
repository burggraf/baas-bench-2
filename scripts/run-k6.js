import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { capture, runtimeManifest, runRunner } from './runtime.js';

capture('npm', ['run', 'build']);
mkdirSync('results', { recursive: true });
const directory = mkdtempSync('results/conformance-');
const id = directory.split('/').at(-1);
const manifest = { kind: 'conformance-only', ...runtimeManifest([
  'dist/conformance.js', 'package-lock.json', 'compose.yaml', 'backends/trailbase/configuration/config.textproto',
  'backends/trailbase/configuration/migrations/main/U1792454400__social_schema.sql',
]) };
writeFileSync(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2));
assert.equal(runRunner(directory, 'node', ['node', 'scripts/conformance.js']), 0, `Node failed; evidence: ${directory}`);
assert.equal(runRunner(directory, 'k6', ['k6', 'run', '--out', `json=/results/${id}/k6-metrics.json.gz`, '--summary-export', `/results/${id}/k6-summary.json`, '/scripts/conformance.js']), 0, `k6 failed; evidence: ${directory}`);
console.log(`Conformance evidence: ${directory} (not a capacity result)`);
