import assert from 'node:assert/strict';
import {actions} from './workload.js';
import {parseCgroup} from './resources.js';
import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';

export function nextCampaignTrial(history, limits) {
  const {startVus,minVus,maxVus,maxTrials,precision}=limits;
  assert.ok(history.length<=maxTrials);
  assert.equal(new Set(history.map(t=>t.vus)).size,history.length,'Never retry a candidate automatically');
  for(const t of history)assert.ok(Number.isSafeInteger(t.vus)&&t.vus>=minVus&&t.vus<=maxVus&&['pass','slo_failure','invalid','generator_limited'].includes(t.verdict));
  const lowerVus=Math.max(0,...history.filter(t=>t.verdict==='pass').map(t=>t.vus));
  const failures=history.filter(t=>t.verdict==='slo_failure').map(t=>t.vus),upperVus=failures.length?Math.min(...failures):null;
  const stop=reason=>({stop:reason,lowerVus:lowerVus||null,upperVus,certified:false});
  const unsafe=history.find(t=>!['pass','slo_failure'].includes(t.verdict));
  if(unsafe)return stop(unsafe.verdict);
  if(history.length>=maxTrials)return stop('trial_limit_reached');
  if(!history.length)return {vus:startVus,phase:'discovery'};
  if(upperVus!==null){
    if(!lowerVus)return history.length===1?{vus:minVus,phase:'fallback'}:stop('no_passing_candidate');
    assert.ok(lowerVus<upperVus,'Non-monotonic evidence is not a capacity bracket');
    if((upperVus-lowerVus)/lowerVus<=precision)return stop('precision_reached');
    if(history[0].verdict==='slo_failure'&&history.at(-1).phase==='fallback'&&history.at(-1).verdict==='pass'&&lowerVus*2<upperVus)return {vus:lowerVus*2,phase:'fallback'};
    return {vus:Math.floor((lowerVus+upperVus)/2),phase:'refinement'};
  }
  return lowerVus>=maxVus?stop('search_ceiling_reached'):{vus:Math.min(maxVus,lowerVus*2),phase:'discovery'};
}

export function classifyCampaignTrial(report, summary, cpuPressure) {
  const verdict=(value,reasons)=>({verdict:value,reasons,certified:false,generatorHeadroom:'unverified'});
  if(!report.workloadValid||!report.resources?.valid||report.interrupted||![0,99].includes(report.exitStatus))return verdict('invalid',['workload_or_resource_evidence']);
  if(cpuPressure)return verdict('generator_limited',['sustained_measured_runner_cpu_pressure']);
  const reasons=[];
  for(const name of actions){
    const a=report.actions?.[name];
    if(!a||!Number.isSafeInteger(a.count)||a.count<=0||a.requested!==a.count||!Number.isSafeInteger(a.failures)||a.failures<0||a.failures>a.count||![a.p95Ms,a.p99Ms].every(v=>Number.isFinite(v)&&v>=0))return verdict('invalid',[`missing_or_invalid_action:${name}`]);
    if(a.p95Ms>(['listPublic','listOwn','read'].includes(name)?500:750)||a.p99Ms>2000||a.failures/a.count>=0.01)reasons.push(`observed_action_slo:${name}`);
  }
  for(const name of ['auth_failed','auth_http_failed','logical_failed{phase:measurement}','http_req_failed']){
    const rate=summary.metrics?.[name]?.value;
    if(!Number.isFinite(rate)||rate<0||rate>1)return verdict('invalid',[`missing_or_invalid_rate:${name}`]);
    if(name.startsWith('auth_')?rate>0:rate>=0.01)reasons.push(`observed_rate:${name}`);
  }
  if(report.loginMeasurementCount>0){
    if(![report.loginP95Ms,report.loginP99Ms].every(v=>Number.isFinite(v)&&v>=0))return verdict('invalid',['missing_login_duration']);
    if(report.loginP95Ms>1000||report.loginP99Ms>3000)reasons.push('observed_login_slo');
  }
  if(report.exitStatus===99&&!reasons.length)return verdict('invalid',['unexplained_native_threshold_failure']);
  return verdict(reasons.length?'slo_failure':'pass',reasons.length?reasons:['short_run_observation_only; insufficient tails remain uncertified']);
}

// Conservative safety limits, not a claim that crossing them proves backend/generator capacity.
export function campaignResourceStop(row, runnerMemoryBytes=2147483648, backendMemoryStopFraction=0.85) {
  assert.ok([2147483648,4294967296,17179869184].includes(runnerMemoryBytes));
  assert.ok([0.85,0.95].includes(backendMemoryStopFraction));
  assert.ok(backendMemoryStopFraction===0.85||runnerMemoryBytes===17179869184, 'Backend95 requires the explicit16GiB profile');
  if(row.type==='error')return 'invalid_telemetry';
  if(row.type==='lifecycle'){
    if(row.source.oomKilled)return `${row.role}_oom`;
    if(row.role==='backend'&&(!row.source.running||row.source.health!=='healthy'))return 'backend_health';
    if(row.role==='runner'&&row.source.status==='exited'&&![0,99].includes(row.source.exitCode))return 'runner_abnormal_exit';
  }
  if(row.type==='host_memory'&&runnerMemoryBytes>=4294967296){
    if(row.source?.exitCode!==0||typeof row.source?.stdout!=='string'||row.source.stderr!=='')return 'invalid_host_telemetry';
    if(row.source.platform==='linux')return vmMemoryStop(row.source.stdout);
    if((row.source.platform!==undefined&&row.source.platform!=='darwin')||!/^\d+\s*$/.test(row.source.stdout))return 'invalid_host_telemetry';
    if(row.source.stdout.trim()!=='1')return 'macos_memory_pressure';
  }
  if(row.type==='cgroup'){
    const g=parseCgroup(row.source),limit=row.role==='runner'?runnerMemoryBytes:4294967296;
    if(g.memoryCurrentBytes===null||!['max','oom','oom_kill'].every(k=>Number.isSafeInteger(g.memoryEvents[k])))return 'invalid_telemetry';
    if(['max','oom','oom_kill'].some(k=>g.memoryEvents[k]>0))return `${row.role}_memory_events`;
    if(g.memoryCurrentBytes>=limit*(row.role==='backend'?backendMemoryStopFraction:0.85))return `${row.role}_memory_guard`;
    if(row.role==='runner'&&runnerMemoryBytes>=4294967296)return vmMemoryStop(row.source.match(/\[vm\.meminfo\]\n([^[]*)/)?.[1]??'');
  }
  return null;
}

export function prestartMemoryReserve(runnerMemoryBytes=4294967296) {
  assert.ok([4294967296,17179869184].includes(runnerMemoryBytes));
  // The large profile reserves the full backend budget too, before its preparation allocations occur.
  return runnerMemoryBytes*0.85+1073741824+(runnerMemoryBytes===17179869184?4294967296:0);
}

export function vmMemoryStop(source, initial=false, runnerMemoryBytes=4294967296) {
  if(typeof source!=='string')return 'invalid_vm_telemetry';
  const values={};
  for(const name of ['MemTotal','MemAvailable','SwapTotal','SwapFree']){
    const hits=[...source.matchAll(new RegExp(`^${name}:\\s+(\\d+) kB\\s*$`,'gm'))];
    if(hits.length!==1)return 'invalid_vm_telemetry';
    values[name]=Number(hits[0][1])*1024;
    if(!Number.isSafeInteger(values[name]))return 'invalid_vm_telemetry';
  }
  if(values.MemTotal<=0||values.MemAvailable>values.MemTotal||values.SwapFree>values.SwapTotal)return 'invalid_vm_telemetry';
  if(values.SwapFree!==values.SwapTotal)return 'vm_swap_pressure';
  if(values.MemAvailable<(initial?prestartMemoryReserve(runnerMemoryBytes):1073741824))return 'vm_memory_reserve';
  return null;
}

export function assertHostMemoryCoverage(records, runnerMemoryBytes=4294967296) {
  const host=records.filter(r=>r.type==='host_memory'&&r.role==='host');
  assert.ok(host.length>=2,'Missing host pressure samples');
  const times=[0,...host.map(r=>r.elapsedMs),Math.max(...records.map(r=>r.elapsedMs))];
  assert.ok(times.every((v,i)=>Number.isFinite(v)&&v>=0&&(!i||(v>=times[i-1]&&v-times[i-1]<=5000))),'Gapped/reordered host pressure samples');
  assert.ok(host.every(r=>campaignResourceStop(r,runnerMemoryBytes)===null),'Invalid/unsafe host pressure samples');
}

export async function measurementStart(path) {
  const input=createReadStream(path),gzip=createGunzip(),lines=createInterface({input:input.pipe(gzip),crlfDelay:Infinity});
  input.on('error',error=>gzip.destroy(error));
  try {
    for await(const line of lines){
      const row=JSON.parse(line);
      if(row.type==='Point'&&row.metric==='action_requested'&&row.data.tags.phase==='measurement'){
        const at=Date.parse(row.data.time);assert.ok(Number.isFinite(at));return at;
      }
    }
    throw new Error('No original measurement action point');
  } finally {lines.close();input.destroy();gzip.destroy();}
}

export function campaignCpuPressure(rows, measurementStart, seconds) {
  const samples=rows.filter(r=>Date.parse(r.at)>=measurementStart&&Date.parse(r.at)<=measurementStart+seconds*1000);
  for(let i=0;i<samples.length;i++)for(let j=i+1;j<samples.length&&samples[j].elapsedMs-samples[i].elapsedMs<=6000;j++){
    const elapsed=samples[j].elapsedMs-samples[i].elapsedMs;
    if(elapsed>=5000&&(parseCgroup(samples[j].source).cpuStat.usage_usec-parseCgroup(samples[i].source).cpuStat.usage_usec)/(elapsed*1000)>=3.6)return true;
  }
  return false;
}
