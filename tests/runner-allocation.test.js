import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { initClient } from 'trailbase';
import { createTransport } from '../src/k6/transport.js';
import { initialState, performAction } from '../src/actions.js';
import { readFileSync } from 'node:fs';

test('reused SDK handles observe renewed headers and preserve unsafe integer parsing', async () => {
  const headers = [];
  const client = initClient(undefined, { transport: createTransport('http://backend:4000', async (_method, _url, _body, params) => {
    headers.push(params.headers['X-Test']);
    return { status: 200, body: '{"id":"p1","author":"u1","title":"post","body":"' + 'x'.repeat(1024) + '","large":9007199254740993}' };
  }) });
  let current = 'first';
  const fetch = client.fetch.bind(client);
  client.fetch = (url, opts = {}) => fetch(url, { ...opts, headers: { ...opts.headers, 'X-Test': current } });
  const records = client.records.bind(client), counts = [];
  client.records = name => { counts.push(name); return records(name); };
  const config = JSON.parse(readFileSync('configs/smoke.json'));
  const state = initialState({ id: 'u1', index: 0, posts: ['p1'], likes: [] }, ['p1'], config);
  await performAction(client, state, 'read', config, () => 0, () => assert.fail());
  current = 'second';
  await performAction(client, state, 'read', config, () => 0, () => assert.fail());
  assert.deepEqual(counts, ['posts', 'likes']);
  assert.deepEqual(headers, ['first', 'second']);
  assert.equal((await records('posts').read('p1')).large, 9007199254740993n);
});

test('TrailBase-specific bundle retains the official SDK and removes unused PocketBase client code', async () => {
  const result = await build({entryPoints:['src/k6/social.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',external:['k6','k6/*'],define:{'__ENV.BENCH_BACKEND':'"trailbase"'},metafile:true,write:false});
  const inputs = Object.values(result.metafile.outputs)[0].inputs;
  assert.ok(Object.entries(inputs).some(([name,info]) => name.includes('node_modules/trailbase/') && info.bytesInOutput > 0));
  const pocketbaseBytes = Object.entries(inputs).filter(([name]) => /pocketbase/.test(name)).reduce((sum,[,info]) => sum + info.bytesInOutput,0);
  assert.ok(pocketbaseBytes < 1024, 'only static SDK enum initialization remains');
  assert.ok(!result.outputFiles[0].text.includes('class Client'));
  assert.ok(!result.outputFiles[0].text.includes('authWithPassword('));
});
