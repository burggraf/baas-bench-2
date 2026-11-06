import assert from 'node:assert/strict';
import {readFileSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {preparedActionPhase} from './prepared-actions.js';
import {preparedSchedule} from './workload.js';

// Reconcile original events, never an aggregate count or a reconstructed successful run.
export async function reconcilePrepared(directory,config) {
  const issues=[], sets=Object.fromEntries(['ready','released','entered','completed'].map(k=>[k,new Map()]));
  let preparation={status:'missing',reason:'missing_evidence',expectedUsers:config.vus,readyUsers:null},phaseTiming=null;
  const participation={configuredUsers:config.vus,measuredUsers:null,completedUsers:null};
  try {
    const gate=JSON.parse(readFileSync(`${directory}/prepared-gate.json`,'utf8'));
    const bytes=readFileSync(`${directory}/prepared-gate.jsonl`),rows=bytes.toString().trim().split('\n').map(JSON.parse);
    const allowedReasons=['invalid_request','duplicate_ordinal','auth_failed','deadline','participant_disconnect','clock_inconsistent','token_lifetime','child_exit','cancelled','gate_error'];
    assert.ok(['preparing','failed','released'].includes(gate.status));assert.ok(gate.reason===null||allowedReasons.includes(gate.reason));
    preparation={status:gate.status,reason:gate.reason,expectedUsers:config.vus,ledgerHash:createHash('sha256').update(bytes).digest('hex')};
    for(const key of ['admittedUsers','readyUsers','elapsedMs','loginsPerSecond','concurrency','timeoutSeconds']){assert.ok(Number.isFinite(gate[key]));preparation[key]=gate[key];}
    assert.equal(gate.expectedUsers,config.vus);assert.equal(gate.loginsPerSecond,config.authPreparation.loginsPerSecond);assert.equal(gate.timeoutSeconds,config.authPreparation.timeoutSeconds);assert.equal(gate.concurrency,1);
    if(gate.status!=='released')issues.push('auth_preparation_failed');
    else {
      const start=rows[0];assert.equal(start.event,'started');assert.equal(start.runId,directory.split('/').at(-1));assert.equal(start.expectedUsers,config.vus);
      assert.equal(start.loginsPerSecond,config.authPreparation.loginsPerSecond);assert.equal(start.timeoutSeconds,config.authPreparation.timeoutSeconds);
      const queued=new Set(),admitted=new Map(),ready=new Map();let active=null,lastAdmission=-Infinity,previous=-Infinity,released,closed;
      for(const row of rows){
        assert.ok(Number.isFinite(row.at)&&Number.isFinite(row.elapsedMs)&&row.elapsedMs>=previous&&row.elapsedMs>=0);previous=row.elapsedMs;
        assert.ok(Math.abs((row.at-start.at)-(row.elapsedMs-start.elapsedMs))<2);
        if(['queued','admitted','ready'].includes(row.event)){
          assert.ok(Number.isSafeInteger(row.ordinal)&&row.ordinal>=1&&row.ordinal<=config.vus&&!released);
          if(row.event==='queued'){assert.ok(!queued.has(row.ordinal));queued.add(row.ordinal);}
          if(row.event==='admitted'){assert.ok(queued.has(row.ordinal)&&!admitted.has(row.ordinal)&&active===null);assert.ok(row.elapsedMs-lastAdmission>=1000/gate.loginsPerSecond-1);lastAdmission=row.elapsedMs;active=row.ordinal;admitted.set(row.ordinal,row);}
          if(row.event==='ready'){assert.equal(active,row.ordinal);assert.ok(!ready.has(row.ordinal));assert.ok([row.loginAtMs,row.expiresAtMs].every(Number.isFinite));assert.ok(row.ttlSeconds===null||Number.isFinite(row.ttlSeconds)&&row.ttlSeconds>0);assert.ok(row.loginAtMs>=admitted.get(row.ordinal).at-1&&row.loginAtMs<=row.at+1);ready.set(row.ordinal,row);active=null;}
        }else if(row.event==='released'){
          assert.ok(!released&&active===null&&ready.size===config.vus);assert.equal(row.releaseAt,gate.releaseAt);assert.ok(row.releaseAt>row.at&&row.releaseAt<=row.at+2001);assert.ok(row.elapsedMs<gate.timeoutSeconds*1000);
          released=row;phaseTiming={releaseAt:row.releaseAt,measurementAt:preparedSchedule(config,row.releaseAt,1).measurementAt,endAt:preparedSchedule(config,row.releaseAt,1).endAt};
        }else if(row.event==='closed'){assert.ok(!closed&&released&&row.status==='released'&&row.at<=released.releaseAt);closed=row;}
        else assert.ok(row.event==='started'&&row===start);
      }
      assert.ok(released&&closed&&admitted.size===config.vus&&ready.size===config.vus&&gate.admittedUsers===admitted.size&&gate.readyUsers===ready.size);
      preparation.achievedAdmissionRate=config.vus===1?null:(config.vus-1)*1000/(Math.max(...[...admitted.values()].map(r=>r.elapsedMs))-Math.min(...[...admitted.values()].map(r=>r.elapsedMs)));
      preparation.releaseAt=released.releaseAt;
      preparation.firstLoginAt=Math.min(...[...ready.values()].map(r=>r.loginAtMs));preparation.lastLoginAt=Math.max(...[...ready.values()].map(r=>r.loginAtMs));
      const ttls=[...ready.values()].map(r=>r.ttlSeconds).filter(n=>n!==null);
      preparation.ttlSeconds=ttls.length?{min:Math.min(...ttls),max:Math.max(...ttls)}:null;
      preparation.nativeTtlKnownUsers=ttls.length;
      for(const [ordinal,row]of ready)assert.ok(row.expiresAtMs>preparedSchedule(config,released.releaseAt,ordinal).activationAt+10000);
      preparation.remainingLifetimeAtReleaseSeconds={min:Math.min(...[...ready.values()].map(r=>(r.expiresAtMs-released.releaseAt)/1000)),max:Math.max(...[...ready.values()].map(r=>(r.expiresAtMs-released.releaseAt)/1000))};
      const starts=new Map(),requests=new Map();let identityStorage=null;
      const input=createReadStream(`${directory}/k6-metrics.json.gz`),gzip=createGunzip(),lines=createInterface({input:input.pipe(gzip),crlfDelay:Infinity});
      input.on('error',error=>gzip.destroy(error));
      try {
        for await(const line of lines){
          const point=JSON.parse(line);if(point.type!=='Point')continue;
          if(['action_requested','prepared_action_start'].includes(point.metric)){
            const {value,time,tags,metadata}=point.data??{},emitted=Date.parse(time);
            const storage=metadata&&('ordinal' in metadata||'sequence' in metadata)?'metadata':'tags';
            const identity=storage==='metadata'?metadata:tags;
            if(storage==='metadata')assert.ok(!('ordinal' in tags)&&!('sequence' in tags));
            if(identityStorage===null)identityStorage=storage;
            assert.equal(storage,identityStorage,'Mixed action identity protocols');
            const ordinal=Number(identity?.ordinal),sequence=Number(identity?.sequence);
            assert.ok(Number.isSafeInteger(ordinal)&&ordinal>=1&&ordinal<=config.vus&&String(ordinal)===identity.ordinal);
            assert.ok(Number.isSafeInteger(sequence)&&sequence>=1&&String(sequence)===identity.sequence);
            assert.ok(Object.hasOwn(config.weights,tags.action)&&['ramp','warmup','measurement'].includes(tags.phase));
            assert.ok(Number.isFinite(emitted)&&emitted>=phaseTiming.releaseAt-101&&emitted<=phaseTiming.endAt+30000);
            const key=ordinal+':'+sequence,target=point.metric==='prepared_action_start'?starts:requests;
            assert.ok(!target.has(key));
            if(point.metric==='prepared_action_start'){
              assert.ok(Number.isFinite(value)&&value<phaseTiming.endAt);
              assert.equal(preparedActionPhase(config,phaseTiming.releaseAt,value),tags.phase);
              // The original native clock permits <=100 ms wall/monotonic skew; allow ms truncation.
              assert.ok(emitted>=value-101);
            }else assert.equal(value,1);
            target.set(key,{value,emitted,action:tags.action,phase:tags.phase,ordinal,sequence});
          }
          if(point.metric!=='prepared_user')continue;
          const event=point.data?.tags?.event,ordinal=point.data?.value,at=Date.parse(point.data?.time);
          assert.ok(Object.hasOwn(sets,event)&&Number.isSafeInteger(ordinal)&&ordinal>=1&&ordinal<=config.vus&&Number.isFinite(at)&&!sets[event].has(ordinal));
          if(event==='ready')assert.ok(at>=admitted.get(ordinal).at-1&&at<=ready.get(ordinal).at+1);
          if(event==='released')assert.ok(at>=released.at-1&&at<=released.releaseAt);
          if(event==='entered')assert.ok(at>=phaseTiming.measurementAt&&at<phaseTiming.endAt);
          if(event==='completed')assert.ok(at>=phaseTiming.endAt&&at<=phaseTiming.endAt+30000);
          sets[event].set(ordinal,at);
        }
      } finally {lines.close();input.destroy();gzip.destroy();}
      assert.equal(starts.size,requests.size);
      const sequences=new Map();let maximumEmissionDelayMilliseconds=0;
      for(const [key,start]of starts){
        const request=requests.get(key);assert.ok(request);
        assert.equal(request.action,start.action);assert.equal(request.phase,start.phase);
        assert.ok(request.emitted>=start.emitted-1);
        assert.ok(start.value>=preparedSchedule(config,phaseTiming.releaseAt,start.ordinal).activationAt-1);
        maximumEmissionDelayMilliseconds=Math.max(maximumEmissionDelayMilliseconds,request.emitted-start.value);
        const list=sequences.get(start.ordinal)??[];list.push(start);sequences.set(start.ordinal,list);
      }
      assert.equal(sequences.size,config.vus);
      for(const list of sequences.values()){
        assert.ok(list.some(start=>start.phase==='measurement'));
        list.sort((a,b)=>a.sequence-b.sequence);
        for(let i=0;i<list.length;i++){assert.equal(list[i].sequence,i+1);if(i)assert.ok(list[i].value>=list[i-1].value);}
      }
      preparation.actionStarts={protocol:identityStorage==='metadata'?'explicit-action-start-v2':'explicit-action-start-v1',matchedStarts:starts.size,maximumEmissionDelayMilliseconds};
      participation.measuredUsers=sets.entered.size;participation.completedUsers=sets.completed.size;
      participation.missingMeasurementUsers=config.vus-sets.entered.size;participation.missingCompletions=config.vus-sets.completed.size;
      participation.drainMilliseconds=sets.completed.size?Math.max(0,...[...sets.completed.values()].map(at=>at-phaseTiming.endAt)):null;
      for(const set of Object.values(sets))assert.equal(set.size,config.vus);
      for(let ordinal=1;ordinal<=config.vus;ordinal++)assert.ok(sets.ready.get(ordinal)<=sets.released.get(ordinal)&&sets.released.get(ordinal)<sets.entered.get(ordinal)&&sets.entered.get(ordinal)<sets.completed.get(ordinal));
    }
  } catch {issues.push('invalid_prepared_evidence');}
  return {valid:issues.length===0,preparation,participation,phaseTiming,issues};
}
