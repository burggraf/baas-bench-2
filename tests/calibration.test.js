import assert from 'node:assert/strict';
import test from 'node:test';
import { initClient } from 'trailbase';
import { createCalibrationTarget } from '../src/calibration-target.js';
import { calibrationRows, summarizeCalibration, assertCalibrationContainer } from '../src/calibration.js';
import * as calibration from '../src/calibration.js';

test('calibration comparison fixes 32/128-VU allocations without accepting arbitrary parameters', () => {
  assert.equal(typeof calibration.calibrationPlan,'function');
  const baseline=calibration.calibrationPlan([]);
  assert.deepEqual(baseline,{smoke:false,compareVus:false,compareBudgets:false,rates:[25,100,400,1600],seconds:20,warmup:5,allocations:[32],budgets:[{cpus:2,memoryBytes:1073741824}]});
  assert.deepEqual(calibration.calibrationPlan(['--compare-vus']),{...baseline,compareVus:true,allocations:[32,128]});
  const smoke={...baseline,smoke:true,rates:[10,40],seconds:6,warmup:2};
  assert.deepEqual(calibration.calibrationPlan(['--smoke']),smoke);
  for(const args of [['--smoke','--compare-vus'],['--compare-vus','--smoke']])assert.deepEqual(calibration.calibrationPlan(args),{...smoke,compareVus:true,allocations:[32,128]});
  for(const args of [['--smoke','--smoke'],['--compare-vus','--compare-vus'],['--vus','128'],['--compare-vus','--rate=1600'],['--url=http://other']])assert.throws(()=>calibration.calibrationPlan(args));
});

test('budget comparison fixes 128 VUs and two coupled CPU/RAM profiles, never arbitrary or combined sweeps', () => {
  const plan=calibration.calibrationPlan(['--compare-budgets']);
  assert.equal(plan.compareBudgets,true);assert.equal(plan.compareVus,false);assert.deepEqual(plan.allocations,[128]);
  assert.deepEqual(plan.budgets,[{cpus:2,memoryBytes:1073741824},{cpus:4,memoryBytes:2147483648}]);
  assert.deepEqual(plan.rates,[25,100,400,1600]);assert.equal(plan.seconds,20);assert.equal(plan.warmup,5);
  const smoke=calibration.calibrationPlan(['--smoke','--compare-budgets']);assert.deepEqual(smoke.budgets,plan.budgets);assert.deepEqual(smoke.allocations,[128]);assert.deepEqual(smoke.rates,[10,40]);
  for(const args of [['--compare-vus','--compare-budgets'],['--compare-budgets','--compare-budgets'],['--compare-budgets','--cpus=8'],['--compare-budgets','--memory=4g']])assert.throws(()=>calibration.calibrationPlan(args));
});

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
  const runner=label=>({...state,Config:{Labels:{...state.Config.Labels,'com.docker.compose.service':'runner','baas-bench-2.run':label}}});
  for(const rate of [10,25,40,100,400,1600])for(const vus of [32,128])assert.doesNotThrow(()=>assertCalibrationContainer(runner(`${run}-${rate}-vu${vus}`),run,image));
  for(const rate of [10,25,40,100,400,1600])for(const suffix of ['vu128-2cpu-1g','vu128-4cpu-2g'])assert.doesNotThrow(()=>assertCalibrationContainer(runner(`${run}-${rate}-${suffix}`),run,image));
  for(const suffix of ['400-vu128-4cpu-1g','400-vu128-2cpu-2g','400-vu32-4cpu-2g','400-vu128-8cpu-4g','400-vu128-4cpu-2g-extra','400-vu129','400-vu256','401-vu128','400-vu128-extra','400-vu0128'])assert.throws(()=>assertCalibrationContainer(runner(`${run}-${suffix}`),run,image));
  for(const other of [{...state,Image:'other'},{...state,Mounts:[{Type:'volume'}]},{...state,Config:{Labels:{...state.Config.Labels,'baas-bench-2.run':'other'}}},{...state,Config:{Labels:{...state.Config.Labels,'com.docker.compose.project':'baas-bench-2-pilot'}}}]) assert.throws(()=>assertCalibrationContainer(other,run,image));
});
