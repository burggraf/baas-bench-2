import assert from'node:assert/strict';
import test from'node:test';
import{baselinePlan}from'../scripts/baseline.js';
import{campaignResourceStop}from'../src/campaign.js';
const GiB=1073741824,runner=16*GiB;
const vm=`MemTotal: ${32*GiB/1024} kB\nMemAvailable: ${24*GiB/1024} kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n`;
const group=n=>`[cpu.stat]\nusage_usec 1\n[memory.current]\n${n}\n[memory.events]\nmax 0\noom 0\noom_kill 0\n[vm.meminfo]\n${vm}`;
const row=(role,n)=>({type:'cgroup',role,source:group(n)});
test('backend95 is an explicit option confined to the approved16GiB campaign point or tiny campaign smoke',()=>{
  const args=['--campaign','--vus=2000','--runner-memory=16g'],p=baselinePlan([...args,'--backend-memory-stop=95']);
  assert.deepEqual(p,{...baselinePlan(args),backendMemoryStopFraction:.95});assert.equal(p.trials,1);assert.equal(p.search.maxTrials,1);
  assert.equal(baselinePlan(['--campaign','--smoke','--runner-memory=16g','--backend-memory-stop=95']).backendMemoryStopFraction,.95);
  assert.equal(baselinePlan(args).backendMemoryStopFraction,undefined);
  for(const a of [['--campaign','--vus=2000','--runner-memory=4g','--backend-memory-stop=95'],['--campaign','--smoke','--backend-memory-stop=95'],['--workload','--smoke','--runner-memory=16g','--backend-memory-stop=95'],[...args,'--backend-memory-stop=95','--backend-memory-stop=95'],[...args,'--backend-memory-stop=100'],[...args,'--backend-memory-stop=0.95']])assert.throws(()=>baselinePlan(a));
});
test('95 percent changes only the backend current-memory boundary, not legacy defaults or the runner guard',()=>{
  const below=row('backend',Math.ceil(4*GiB*.95)-1),at=row('backend',Math.ceil(4*GiB*.95));
  assert.equal(campaignResourceStop(below,runner,.95),null);
  assert.equal(campaignResourceStop(at,runner,.95),'backend_memory_guard');
  assert.equal(campaignResourceStop(below,runner),'backend_memory_guard');
  assert.equal(campaignResourceStop(row('runner',Math.ceil(runner*.85)),runner,.95),'runner_memory_guard');
});
test('95 percent cannot suppress hardlimit/OOM, health, telemetry, host-swap or live-reserve stops',()=>{
  const base=row('backend',GiB);
  for(const event of ['max','oom','oom_kill'])assert.equal(campaignResourceStop({...base,source:base.source.replace(`${event} 0`,`${event} 1`)},runner,.95),'backend_memory_events');
  assert.equal(campaignResourceStop({type:'lifecycle',role:'backend',source:{running:true,health:'unhealthy',oomKilled:false}},runner,.95),'backend_health');
  assert.equal(campaignResourceStop({type:'error',role:'backend'},runner,.95),'invalid_telemetry');
  assert.equal(campaignResourceStop({...base,source:'bad'},runner,.95),'invalid_telemetry');
  const host=source=>({type:'host_memory',role:'host',source:{platform:'linux',exitCode:0,stdout:source,stderr:''}});
  assert.equal(campaignResourceStop(host(vm.replace(`MemAvailable: ${24*GiB/1024}`,`MemAvailable: ${GiB/2048}`)),runner,.95),'vm_memory_reserve');
  assert.equal(campaignResourceStop(host(vm.replace('SwapTotal: 0','SwapTotal: 1024')),runner,.95),'vm_swap_pressure');
});
test('guard rejects unapproved fractions and95percent without the explicit16GiB runner',()=>{
  for(const fraction of [0,.9,.96,1,NaN,'0.95',null])assert.throws(()=>campaignResourceStop({type:'stats'},runner,fraction));
  for(const memory of [2*GiB,4*GiB])assert.throws(()=>campaignResourceStop({type:'stats'},memory,.95));
});
