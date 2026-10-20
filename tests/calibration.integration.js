import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const execute=promisify(execFile);

test('calibration refuses caller resource overrides before creating a run or lock', async()=>{
  for(const key of ['CALIBRATION_RUNNER_CPUS','CALIBRATION_RUNNER_MEMORY'])await assert.rejects(execute(process.execPath,['scripts/calibrate.js','--smoke'],{env:{...process.env,[key]:'8'}}),error=>error.code===1&&error.stdout===''&&error.stderr.includes('Calibration failed'));
  assert.equal(existsSync('.fixtures/operation.lock'),false);
});

for(const mode of ['default','compare-vus','compare-budgets'])test(`isolated SDK calibration ${mode} preserves pilot volume, emits private-free raw evidence and removes only ephemeral resources`, {timeout:180000}, async()=>{
  const compareVus=mode==='compare-vus',compareBudgets=mode==='compare-budgets';
  const {stdout}=await execute(process.execPath,['scripts/calibrate.js','--smoke',...(mode==='default'?[]:[`--${mode}`])],{timeout:170000,maxBuffer:16*1024*1024});
  const directory=stdout.match(/Calibration evidence: (results\/calibration-[A-Za-z0-9]{6})/)?.[1]; assert.ok(directory);
  const report=JSON.parse(readFileSync(`${directory}/report.json`));
  assert.equal(report.valid,true);assert.equal(report.certified,false);assert.equal(report.generatorHeadroom,'unverified');
  assert.deepEqual(report.pilotVolumeBefore,report.pilotVolumeAfter); assert.equal(report.trials.length,mode==='default'?2:4);
  assert.deepEqual(report.allocations,compareBudgets?[128]:compareVus?[32,128]:[32]);
  assert.deepEqual(report.trials.map(t=>[t.offeredPerSecond,t.preAllocatedVUs,t.maxVUs]),compareBudgets?[[10,128,128],[10,128,128],[40,128,128],[40,128,128]]:compareVus?[[10,32,32],[10,128,128],[40,32,32],[40,128,128]]:[[10,32,32],[40,32,32]]);
  const small={cpus:2,memoryBytes:1073741824},large={cpus:4,memoryBytes:2147483648};
  assert.deepEqual(report.budgets,compareBudgets?[small,large]:[small]);
  assert.deepEqual(report.trials.map(t=>t.runnerBudget),compareBudgets?[small,large,small,large]:report.trials.map(()=>small));
  for(const trial of report.trials) {
    assert.equal(trial.valid,true); assert.equal(trial.rateDelivered,true); assert.equal(trial.dropped,0);
    for(const file of readdirSync(`${directory}/${trial.id}`)) {
      const b=readFileSync(`${directory}/${trial.id}/${file}`),text=(file.endsWith('.gz')?gunzipSync(b):b).toString();
      assert.doesNotMatch(text,/auth_token|refresh_token|"password"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if(file==='k6-metrics.json.gz') {
        const points=text.trim().split('\n').map(JSON.parse);
        assert.ok(points.some(row=>row.type==='Point'&&row.metric==='calibration_failed'&&row.data.tags.scenario==='warmup'),'warm-up validation outcomes retained');
        const allocation=points.filter(row=>row.type==='Point'&&row.metric==='vus_max');
        assert.ok(allocation.length>0,'actual native VU pool evidence retained');
        assert.ok(allocation.every(row=>Number.isSafeInteger(row.data.value)&&row.data.value>=0&&row.data.value<=trial.maxVUs),'pool never exceeds its declared bound');
        // k6 emits this gauge while initializing VUs, before any scenario traffic starts.
        const firstRequest=Math.min(...points.filter(row=>row.type==='Point'&&row.metric==='http_reqs').map(row=>Date.parse(row.data.time)));
        const active=allocation.filter(row=>Date.parse(row.data.time)>=firstRequest);
        assert.ok(active.length>0,'pool evidence must cover traffic, not just initialization');
        assert.ok(active.every(row=>row.data.value===trial.maxVUs),'full declared pool remains allocated throughout traffic');
      }
    }
    const limits=readFileSync(`${directory}/${trial.id}/runner-limits.txt`,'utf8').trim().split(/\s+/).map(Number);
    assert.deepEqual(limits,[trial.runnerBudget.cpus*100000,100000,trial.runnerBudget.memoryBytes,0]);
    const resources=JSON.parse(readFileSync(`${directory}/${trial.id}/resources-summary.json`));assert.equal(resources.valid,true);
    const cgroups=readFileSync(`${directory}/${trial.id}/resources.jsonl`,'utf8').trim().split('\n').map(JSON.parse).filter(row=>row.type==='cgroup'&&row.role==='runner');
    assert.ok(cgroups.length>=2);assert.ok(cgroups.every(row=>row.collection==='container-self'));
    assert.equal(cgroups.at(-1).capturedFinal,true,'final counters are captured before container exit, never suppressed');
  }
  assert.equal(existsSync('.fixtures/operation.lock'),false);assert.equal(existsSync('.fixtures/trailbase.json'),false);
  for(const type of ['ps','network']) {
    const args=type==='ps'?['ps','-aq']:['network','ls','-q'];
    const result=await execute('docker',[...args,'--filter','label=com.docker.compose.project=baas-bench-2-calibration']); assert.equal(result.stdout.trim(),'');
  }
});
