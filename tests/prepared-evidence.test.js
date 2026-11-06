import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {summarize} from '../src/report.js';
import {classifyCampaignTrial} from '../src/campaign.js';
const config={...JSON.parse(readFileSync('configs/smoke.json')),version:'social-prepared-v1',authPreparation:{loginsPerSecond:5,timeoutSeconds:30}};
function fixture(t){
  const root=mkdtempSync(tmpdir()+'/prepared-evidence-'),directory=root+'/social-Abc123';mkdirSync(directory);t.after(()=>rmSync(root,{recursive:true}));
  const rows=[{event:'started',at:100000,elapsedMs:0,runId:'social-Abc123',expectedUsers:2,loginsPerSecond:5,timeoutSeconds:30},
    {event:'queued',ordinal:1,at:100001,elapsedMs:1},{event:'admitted',ordinal:1,at:100002,elapsedMs:2},
    {event:'ready',ordinal:1,at:100010,elapsedMs:10,loginAtMs:100009,expiresAtMs:3700000,ttlSeconds:3600},
    {event:'queued',ordinal:2,at:100011,elapsedMs:11},{event:'admitted',ordinal:2,at:100202,elapsedMs:202},
    {event:'ready',ordinal:2,at:100210,elapsedMs:210,loginAtMs:100209,expiresAtMs:3700200,ttlSeconds:3600},
    {event:'released',at:100211,elapsedMs:211,releaseAt:102211},{event:'closed',at:100212,elapsedMs:212,status:'released'}];
  const gate={status:'released',reason:null,expectedUsers:2,admittedUsers:2,readyUsers:2,releaseAt:102211,elapsedMs:212,loginsPerSecond:5,concurrency:1,timeoutSeconds:30};
  const point=(event,ordinal,at)=>({type:'Point',metric:'prepared_user',data:{value:ordinal,time:new Date(at).toISOString(),tags:{event}}});
  const points=[point('ready',1,100009),point('ready',2,100209),point('released',1,100215),point('released',2,100216),point('entered',1,105211),point('entered',2,105212),point('completed',1,117211),point('completed',2,117212)];
  for(const ordinal of [1,2]){const tags={ordinal:String(ordinal),sequence:'1',action:'read',phase:'measurement'};points.push({type:'Point',metric:'prepared_action_start',data:{value:105220,time:new Date(105220).toISOString(),tags}},{type:'Point',metric:'action_requested',data:{value:1,time:new Date(105221).toISOString(),tags}});}
  const persist=()=>{writeFileSync(directory+'/prepared-gate.json',JSON.stringify(gate));writeFileSync(directory+'/prepared-gate.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n');writeFileSync(directory+'/k6-metrics.json.gz',gzipSync(points.map(r=>JSON.stringify(r)).join('\n')+'\n'));};persist();return {directory,rows,points,gate,persist};
}
const load=async()=>{assert.ok(existsSync('src/prepared-evidence.js'),'Prepared evidence must be independently reconciled');return import('../src/prepared-evidence.js');};
test('reconciles distinct prepared/participating users and authoritative complete phase windows',async t=>{
  const f=fixture(t),{reconcilePrepared}=await load(),r=await reconcilePrepared(f.directory,config);
  assert.equal(r.valid,true);assert.equal(r.preparation.readyUsers,2);assert.equal(r.participation.measuredUsers,2);assert.equal(r.participation.completedUsers,2);
  assert.deepEqual(r.phaseTiming,{releaseAt:102211,measurementAt:105211,endAt:117211});assert.match(r.preparation.ledgerHash,/^[a-f0-9]{64}$/);
});
for(const mode of ['duplicate','missing','extra','early','late-release','malformed','incomplete-ledger','invalid-order','wrong-version-timing','business-before-release','missing-gate-close','late-gate-close'])test(`prepared evidence rejects ${mode}`,async t=>{
  const f=fixture(t),{reconcilePrepared}=await load();
  if(mode==='duplicate')f.points.push(f.points[4]);
  if(mode==='missing')f.points.splice(5,1);
  if(mode==='extra')f.points[4].data.value=3;
  if(mode==='early')f.points[4].data.time=new Date(100210).toISOString();
  if(mode==='late-release')f.points[3].data.time=new Date(103000).toISOString();
  if(mode==='malformed')f.points[4].data.value='1';
  if(mode==='incomplete-ledger')f.rows.splice(5,1);
  if(mode==='invalid-order')f.rows[5].elapsedMs=1;
  if(mode==='wrong-version-timing')f.gate.releaseAt++;
  if(mode==='missing-gate-close')f.rows.pop();
  if(mode==='late-gate-close'){f.rows.at(-1).at=103000;f.rows.at(-1).elapsedMs=3000;}
  if(mode==='business-before-release')f.points.push({type:'Point',metric:'action_requested',data:{value:1,time:new Date(100210).toISOString(),tags:{phase:'preparation',action:'read'}}});
  f.persist();assert.equal((await reconcilePrepared(f.directory,config)).valid,false);
});
test('missing/failed preparation remains an explicit invalid outcome, never empty successful measurement',async t=>{
  const f=fixture(t),{reconcilePrepared}=await load();f.gate.status='failed';f.gate.reason='auth_failed';f.persist();
  const r=await reconcilePrepared(f.directory,config);assert.equal(r.valid,false);assert.equal(r.preparation.status,'failed');assert.equal(r.preparation.reason,'auth_failed');
  rmSync(f.directory+'/k6-metrics.json.gz');assert.equal((await reconcilePrepared(f.directory,config)).valid,false);
});
function summary(){
  const metrics={users_finished:{count:2},auth_login_count:{count:2},'auth_login_attempts{phase:preparation}':{count:2},'auth_login_count{phase:preparation}':{count:2},'auth_login_failed{phase:preparation}':{count:0},prepared_probe_failed:{passes:0,fails:2,value:0},auth_failed:{passes:0,value:0},auth_http_failed:{value:0},'logical_failed{phase:measurement}':{value:0},'http_req_failed{traffic:backend}':{value:0},'http_req_failed{traffic:control}':{value:0}};
  for(const [action,weight]of Object.entries(config.weights)){
    for(const metric of ['action_requested','action_completed'])metrics[`${metric}{action:${action},phase:measurement}`]={count:weight*1000};
    metrics[`action_failed{action:${action},phase:measurement}`]={count:0};metrics[`action_duration{action:${action},phase:measurement}`]={'p(95)':10,'p(99)':20};
  }return {metrics};
}
test('prepared application evidence is independent of unexercised measured login/refresh tails',()=>{
  const evidence={valid:true,preparation:{status:'released'},participation:{measuredUsers:2},phaseTiming:{releaseAt:1,measurementAt:3001,endAt:15001},issues:[]};
  const r=summarize(summary(),config,evidence);
  assert.equal(r.kind,'prepared-session-fixed-vu-exploratory');assert.equal(r.workloadVersion,'social-prepared-v1');assert.equal(r.valid,true);assert.equal(r.sloEvidence,'exploratory_only');
  assert.equal(r.authenticationEvidence.login.state,'not_exercised');assert.equal(r.authenticationEvidence.refresh.state,'not_exercised');assert.equal(r.loginP95Ms,null);
  assert.equal(r.preparation.loginAttempts,2);assert.equal(r.preparation.loginSuccesses,2);assert.equal(r.preparation.protectedReadSuccesses,2);assert.equal(r.preparation.protocol,'loopback-prepared-v1');
  const warmupRefresh=summary();warmupRefresh.metrics.auth_refresh_count={count:5};warmupRefresh.metrics['auth_refresh_count{phase:warmup}']={count:5};assert.equal(summarize(warmupRefresh,config,evidence).authenticationEvidence.refresh.state,'not_exercised');
  assert.equal(summarize(summary(),config).valid,false,'No gate evidence is not readiness proof');
  const report={...r,workloadValid:true,resources:{valid:true},interrupted:null,exitStatus:0};assert.equal(classifyCampaignTrial(report,summary(),false).verdict,'pass');
  assert.equal(classifyCampaignTrial({...report,preparation:{status:'failed',reason:'auth_failed'}},summary(),false).verdict,'invalid');
  assert.equal(classifyCampaignTrial(report,summary(),true).verdict,'generator_limited');
});
test('an absent native summary preserves actual gate evidence without inventing zero auth/action failures',()=>{
  const evidence={valid:false,preparation:{status:'failed',reason:'deadline',readyUsers:1},participation:{measuredUsers:null},phaseTiming:null,issues:['auth_preparation_failed']};
  const r=summarize(null,config,evidence);assert.equal(r.valid,false);assert.equal(r.summaryAvailable,false);assert.equal(r.authFailures,null);assert.equal(r.loginCount,null);assert.deepEqual(r.actions,{});assert.equal(r.preparation.readyUsers,1);assert.equal(r.authenticationEvidence.login.state,'unavailable');
});

test('structurally corrupt native summaries preserve preparation failure and unknown counters',()=>{
  const evidence={valid:false,preparation:{status:'failed',reason:'auth_failed',readyUsers:0},issues:['auth_preparation_failed']};
  for(const raw of [{},{metrics:null},{metrics:[]},{metrics:'corrupt'},{metrics:{}}]){
    const r=summarize(raw,config,evidence);assert.equal(r.valid,false);assert.equal(r.summaryAvailable,false);assert.equal(r.authFailures,null);assert.equal(r.preparation.reason,'auth_failed');assert.ok(r.evidenceIssues.includes('missing_or_invalid_summary'));
  }
});

test('prepared classification retains independent action/auth SLO, control and generator outcomes',()=>{
  const evidence={valid:true,preparation:{status:'released'},participation:{measuredUsers:2},phaseTiming:{releaseAt:1,measurementAt:3001,endAt:15001},issues:[]};
  const raw=summary(),base={...summarize(raw,config,evidence),workloadValid:true,resources:{valid:true},interrupted:null,exitStatus:0};
  const auth=structuredClone(raw);auth.metrics.auth_failed={passes:1,value:0.1};assert.equal(classifyCampaignTrial(base,auth,false).verdict,'slo_failure');
  const action=structuredClone(base);action.actions.read.p95Ms=501;assert.equal(classifyCampaignTrial(action,raw,false).verdict,'slo_failure');
  const control=structuredClone(raw);control.metrics['http_req_failed{traffic:control}'].value=0.1;assert.equal(classifyCampaignTrial(base,control,false).verdict,'invalid');
  assert.equal(classifyCampaignTrial({...base,exitStatus:99},raw,false).verdict,'invalid');
  const mismatch=summary();mismatch.metrics['auth_login_attempts{phase:preparation}'].count=3;assert.equal(summarize(mismatch,config,evidence).valid,false);
});

test('successful-login-only durations determine prepared measured login latency; failures stay visible',()=>{
  const m=summary();m.metrics['auth_login_count{phase:measurement}']={count:1000};m.metrics['auth_success_duration{phase:measurement}']={'p(95)':1500,'p(99)':1800};m.metrics['auth_duration{operation:login,phase:measurement}']={'p(95)':1,'p(99)':2};
  const r=summarize(m,config,{valid:true,preparation:{status:'released'},issues:[]});assert.equal(r.loginP95Ms,1500);assert.equal(r.authenticationEvidence.login.state,'sufficient_samples');
});

for(const mode of ['delayed-valid','wrong-phase','missing-start','missing-request','duplicate','wrong-sequence','post-deadline','mismatched-action'])test(`explicit action start ${mode}`,async t=>{
  const f=fixture(t),{reconcilePrepared}=await load();
  const start=f.points.find(p=>p.metric==='prepared_action_start'),request=f.points.find(p=>p.metric==='action_requested');
  start.data.tags={...start.data.tags,phase:'ramp'};request.data.tags={...request.data.tags,phase:'ramp'};
  start.data.value=103210; // One ms before the ramp boundary.
  start.data.time=new Date(103313).toISOString();request.data.time=new Date(103314).toISOString();
  if(mode==='wrong-phase')start.data.tags.phase=request.data.tags.phase='warmup';
  if(mode==='missing-start')f.points.splice(f.points.indexOf(start),1);
  if(mode==='missing-request')f.points.splice(f.points.indexOf(request),1);
  if(mode==='duplicate')f.points.push(structuredClone(start));
  if(mode==='wrong-sequence')start.data.tags.sequence=request.data.tags.sequence='2';
  if(mode==='post-deadline'){start.data.value=117211;start.data.tags.phase=request.data.tags.phase='measurement';}
  if(mode==='mismatched-action')request.data.tags.action='like';
  const more={ordinal:'1',sequence:'2',action:'read',phase:'measurement'};f.points.push({type:'Point',metric:'prepared_action_start',data:{value:106000,time:new Date(106000).toISOString(),tags:more}},{type:'Point',metric:'action_requested',data:{value:1,time:new Date(106001).toISOString(),tags:more}});
  f.persist();assert.equal((await reconcilePrepared(f.directory,config)).valid,mode==='delayed-valid');
});

for (const mode of ['valid','missing','ambiguous','mixed','mismatch']) test(`action metadata preserves strict pair evidence: ${mode}`, async t => {
  const f=fixture(t),{reconcilePrepared}=await load();
  const points=f.points.filter(p=>['prepared_action_start','action_requested'].includes(p.metric));
  for(const p of points){const {ordinal,sequence,...tags}=p.data.tags;p.data.tags=tags;p.data.metadata={ordinal,sequence};}
  if(mode==='missing')delete points[0].data.metadata.sequence;
  if(mode==='ambiguous')points[0].data.tags.ordinal='1';
  if(mode==='mixed'){Object.assign(points[0].data.tags,points[0].data.metadata);delete points[0].data.metadata;}
  if(mode==='mismatch')points[1].data.metadata.sequence='2';
  f.persist();const result=await reconcilePrepared(f.directory,config);
  assert.equal(result.valid,mode==='valid');
  if(mode==='valid'){assert.equal(result.preparation.actionStarts.protocol,'explicit-action-start-v2');assert.equal(result.preparation.actionStarts.matchedStarts,2);}
});
