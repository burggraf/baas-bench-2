import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {classifyCampaignTrial} from './campaign.js';
const read=p=>JSON.parse(readFileSync(p));
// These changes affect orchestration/private error capture only, never timed calls.
const allowedChanged=new Set(['scripts/convex-campaign.js','scripts/convex.js']);
export function reviewConvexHistory(status,trials,currentHashes){
 assert.equal(status.backend,'convex');assert.equal(status.status,'stopped_requires_evidence_review');assert.equal(status.activePoint,null);
 assert.ok(status.history.length>0&&trials.length===status.history.length);assert.equal(new Set(status.history.map(h=>h.vus)).size,status.history.length);
 const changed=Object.keys(status.sourceHashes).filter(p=>status.sourceHashes[p]!==currentHashes[p]);assert.ok(changed.every(p=>allowedChanged.has(p)),'Timed/config/resource inputs changed; start a distinct campaign');
 const issues=[];
 for(const [i,h]of status.history.entries()){
  const {report:r,summary,nativeSummary,shutdown,fixture}=trials[i];
  assert.ok(['pass','slo_failure'].includes(h.verdict));assert.equal(h.shutdownVerified,true);assert.equal(h.cpuPressure,false);
  assert.equal(r.preparedEvidenceValid,true);assert.equal(r.cleanupVerified,true);assert.equal(r.executionFailed,false);assert.equal(r.safetyStop,null);assert.equal(r.authFailures,0);assert.equal(r.workloadValid,true);assert.equal(r.resources.valid,true);
  assert.equal(r.resources.containers.backend.first.aggregateScope,'convex-postgres-stack');assert.equal(r.resources.containers.backend.first.children.length,2);
  assert.equal(r.participation.measuredUsers,h.vus);assert.equal(r.participation.completedUsers,h.vus);assert.equal(r.phaseTiming.endAt-r.phaseTiming.measurementAt,120000);assert.equal(r.end.users,15000);
  assert.equal(h.baseline.users,15000);assert.equal(h.baseline.posts,150000);assert.equal(h.baseline.likes,150000);assert.equal(h.baseline.logicalHash,status.history[0].baseline.logicalHash);
  assert.equal(classifyCampaignTrial(r,nativeSummary,h.cpuPressure).verdict,h.verdict);assert.equal(shutdown.ownedShutdown,true);assert.equal(shutdown.postgresVolumeRetained,true);assert.equal(shutdown.group.members.length,0);
  if(summary.failure){
   assert.equal(i,status.history.length-1,'Only the terminal untimed failure is reviewable');assert.equal(h.verdict,'pass');assert.equal(r.valid,true);
   assert.ok(summary.failure.locations.some(l=>l.includes('at async deleteFixture')&&l.includes('/src/fixtures.js:139:')),'Failure must be the untimed cleanup identity preflight');
   assert.equal(fixture.status,'used');assert.equal(fixture.users.length,15000);assert.equal(fixture.users.some(u=>u.deleted),false);
   issues.push({vus:h.vus,phase:'untimed-cleanup-identity-preflight',originalFailureType:summary.failure.type,measurementValid:true,accountsDeleted:0,ownedShutdownVerified:true});
  }
 }
 assert.equal(issues.length,1,'Resume requires one explicitly reviewed terminal cleanup failure');
 return {history:status.history.map(h=>({...h,...(issues.some(x=>x.vus===h.vus)?{untimedCleanupFailed:true,cleanupFailureReviewed:true}: {})})),limits:status.limits,changedOrchestrationInputs:changed,issues};
}
export function loadReviewedConvexHistory({statusPath,replayPath},currentHashes){
 const status=read(statusPath),audit=read(replayPath);assert.equal(audit.statusPath,statusPath);assert.equal(audit.checks.length,status.history.length);
 for(const h of status.history){const a=audit.checks.find(a=>a.vus===h.vus);assert.ok(a?.rawReconciliationValid&&a.actionAndParticipationReplayMatches&&a.resourcesAndGeneratorCpuReplayMatch&&a.shutdownVerified);assert.equal(a.reportSha256,createHash('sha256').update(readFileSync(h.reportPath)).digest('hex'),'Reviewed report changed');}
 const trials=status.history.map(h=>{
  const d=h.reportPath.replace(/\/report\.json$/,'');const controller=readdirSync(h.work+'/results').find(n=>/^convex-[A-Za-z0-9]{6}$/.test(n));assert.ok(controller);
  const summary=read(`${h.work}/results/${controller}/summary.json`);assert.equal(summary.history[0].workloadDirectory,d.slice(h.work.length+1));
  return {report:read(h.reportPath),summary,nativeSummary:read(d+'/k6-summary.json'),shutdown:read(`${h.work}/results/${controller}/point-${h.vus}/shutdown.json`),...(summary.failure?{fixture:read(h.work+'/.fixtures/convex.json')}: {})};
 });
 if(status.sourceHashes['scripts/convex.js']!==currentHashes['scripts/convex.js']){
  const original=readFileSync(status.history[0].work+'/scripts/convex.js','utf8');assert.equal(createHash('sha256').update(original).digest('hex'),status.sourceHashes['scripts/convex.js']);
  const expected=original.replace("} catch (error) { uncertain ||= error.retainLock === true; failure =", "} catch (error) { savePrivate(`.fixtures/archive/${run}-controller-error.json`,{name:error.name,code:error.code??null,message:error.message,stack:error.stack},true); uncertain ||= error.retainLock === true; failure =");
  assert.notEqual(expected,original);assert.equal(createHash('sha256').update(expected).digest('hex'),currentHashes['scripts/convex.js'],'Only private error capture may differ in the point controller');
 }
 const reviewed=reviewConvexHistory(status,trials,currentHashes);
 return {...reviewed,provenance:{sourceStatus:statusPath,rawReplay:replayPath,sourceHashes:status.sourceHashes,reportHashes:status.history.map(h=>({vus:h.vus,sha256:createHash('sha256').update(readFileSync(h.reportPath)).digest('hex')})),issues:reviewed.issues,changedOrchestrationInputs:reviewed.changedOrchestrationInputs}};
}
