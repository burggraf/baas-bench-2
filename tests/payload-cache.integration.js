import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePayloadCache } from '../scripts/payload-cache.js';

for (const mode of ['success', 'zero-slots', 'bad-hash', 'missing-hash', 'wrong-recipe']) test(`native shared payload cache: ${mode}`, { timeout: 30000 }, async () => {
  assert.match(process.cwd(), /\/\.fixtures\/prepared-native-[A-Za-z0-9-]+$/);
  const directory = mkdtempSync('results/payload-cache-native-'), name = 'payload-cache-' + directory.slice(-6);
  const config = JSON.parse(readFileSync('configs/prepared-smoke.json'));
  if (mode === 'zero-slots') Object.assign(config, { vus: 20000, bodyBytes: 16384 });
  const artifact = await writePayloadCache(directory + '/payload-cache.json', config);
  if (mode === 'wrong-recipe') config.seed++;
  writeFileSync(directory + '/run.json', JSON.stringify(config));
  writeFileSync(directory + '/probe.js', `import {loadPayloadCache} from '/src/k6/payload-cache.js';
import {postFields} from '/src/workload.js'; import {Counter} from 'k6/metrics';
const config=JSON.parse(open('/config/run.json')),fields=loadPayloadCache(config,__ENV.PREPARED_PAYLOAD_SHA256),checks=new Counter('payload_checks');
const zeroSlots=config.vus===20000;
export const options={vus:2,iterations:4,systemTags:[],thresholds:{payload_checks:[zeroSlots?'count==8':'count==144']}};
export default function(){for(const user of (zeroSlots?[config.vus-1]:[0,1,config.vus-1,config.vus]))for(const sequence of (zeroSlots?[11,43]:[1,10,11,12,41,42,43,44,10001])){
 const actual=fields(user,sequence),expected=postFields(config,user,sequence);
 if(actual.body!==expected.body||actual.title!==expected.title)throw Error('payload_mismatch');
 try{actual.body='mutated';}catch(error){if(!(error instanceof TypeError))throw error;}
 if(fields(user,sequence).body!==expected.body)throw Error('shared_payload_mutation');checks.add(1);
}}
`);
  const image = execFileSync('docker', ['image', 'inspect', 'baas-bench-2-pilot-runner', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
  const digest = mode === 'bad-hash' ? '0'.repeat(64) : artifact.sha256;
  const args = ['run', '--rm', '--name', name, '--network', 'none', '--cpus', '1', '--memory', '1g', '--memory-swap', '1g',
    ...(mode === 'missing-hash' ? [] : ['-e', `PREPARED_PAYLOAD_SHA256=${digest}`]),
    '-v', `${resolve('src')}:/src:ro`, '-v', `${resolve(directory)}:/config:ro`, image, 'k6', 'run', '/config/probe.js'];
  const logs = [], child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => logs.push(b)); child.stderr.on('data', b => logs.push(b));
  const timer = setTimeout(() => child.kill('SIGTERM'), 25000);
  let code; try { code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); }); }
  finally { clearTimeout(timer); writeFileSync(directory + '/native.log', Buffer.concat(logs)); }
  assert.equal(execFileSync('docker', ['ps', '-aq', '--filter', `name=^/${name}$`], { encoding: 'utf8' }).trim(), '');
  assert.equal(code, ['success', 'zero-slots'].includes(mode) ? 0 : 107, `Inspect ${directory}`);
  if (mode.includes('hash')) assert.match(Buffer.concat(logs).toString(), /invalid_payload_cache_hash/);
  if (mode === 'wrong-recipe') assert.match(Buffer.concat(logs).toString(), /invalid_payload_cache/);
  writeFileSync(directory + '/verified.json', JSON.stringify({ verified: true, mode, code, image, artifact, requests: 0 }));
});
