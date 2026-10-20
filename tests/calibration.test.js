import assert from 'node:assert/strict';
import test from 'node:test';
import { initClient } from 'trailbase';
import { createCalibrationTarget } from '../src/calibration-target.js';
import { calibrationRows, summarizeCalibration, assertCalibrationContainer } from '../src/calibration.js';

test('synthetic target serves exact SDK list payloads without auth, writes, counts or arbitrary routes', async t => {
  const server = createCalibrationTarget();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const rows = calibrationRows();
  assert.equal(rows.length, 20); assert.ok(rows.every(r => r.body.length === 1024));
  assert.deepEqual((await initClient(base).records('posts').list({ pagination: { limit: 20 }, order: ['-created_at', '-id'] })).records, rows);
  for (const [path, options] of [['/api/auth/v1/login', {}], ['/api/records/v1/posts?limit=1', {}], ['/api/records/v1/posts?limit=20&count=true', {}], ['/api/records/v1/posts', {method:'POST', body:'{}'}], ['/api/records/v1/posts?limit=20&order=-created_at,-id', {headers:{authorization:'not-a-token'}}], ['/api/records/v1/posts?limit=20&order=-created_at,-id', {headers:{'refresh-token':'not-a-token'}}]]) {
    const response = await fetch(base + path, options); assert.ok(response.status >= 400);
    assert.ok(!(await response.text()).includes('not-a-token'));
  }
});

test('calibration distinguishes delivery misses from invalid evidence and never certifies headroom', () => {
  const summary = { metrics: { calibration_started:{count:200}, calibration_completed:{count:200}, calibration_failed:{value:0}, 'dropped_iterations{scenario:measure}':{count:0}, calibration_ms:{'p(95)':2}, calibration_non_http_ms:{'p(95)':1} } };
  const r = summarizeCalibration(summary,10,20,{valid:true});
  assert.equal(r.valid,true); assert.equal(r.rateDelivered,true); assert.equal(r.generatorHeadroom,'unverified'); assert.equal(r.certified,false);
  assert.equal(summarizeCalibration({...summary,metrics:{...summary.metrics,calibration_started:{count:150},calibration_completed:{count:150},'dropped_iterations{scenario:measure}':{count:50}}},10,20,{valid:true}).rateDelivered,false);
  for (const metric of Object.keys(summary.metrics)) {
    const metrics={...summary.metrics}; delete metrics[metric];
    assert.equal(summarizeCalibration({metrics},10,20,{valid:true}).valid,false,metric);
  }
  assert.equal(summarizeCalibration(summary,10,20,{valid:false}).valid,false);
  assert.equal(summarizeCalibration({...summary,metrics:{...summary.metrics,calibration_failed:{value:0.1}}},10,20,{valid:true}).valid,false);
});

test('calibration cleanup refuses foreign containers, wrong image/run and persistent volumes', () => {
  const run='calibration-ABC123', image='sha256:abc';
  const state={Id:'a'.repeat(64),Image:image,Config:{Labels:{'com.docker.compose.project':'baas-bench-2-calibration','com.docker.compose.service':'target','baas-bench-2.run':run}},Mounts:[]};
  assert.doesNotThrow(()=>assertCalibrationContainer(state,run,image));
  for(const other of [{...state,Image:'other'},{...state,Mounts:[{Type:'volume'}]},{...state,Config:{Labels:{...state.Config.Labels,'baas-bench-2.run':'other'}}},{...state,Config:{Labels:{...state.Config.Labels,'com.docker.compose.project':'baas-bench-2-pilot'}}}]) assert.throws(()=>assertCalibrationContainer(other,run,image));
});
