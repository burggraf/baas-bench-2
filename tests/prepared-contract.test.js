import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import * as workload from '../src/workload.js';
import {baselinePlan} from '../scripts/baseline.js';
import {pocketbasePlan} from '../scripts/pocketbase.js';

const legacy = JSON.parse(readFileSync('configs/smoke.json'));
const prepared = () => ({...legacy, version:'social-prepared-v1', authPreparation:{loginsPerSecond:5,timeoutSeconds:30}});

test('prepared schema is explicit, bounded and does not change legacy configs', () => {
  assert.equal(workload.validateConfig(legacy), legacy);
  const c=prepared(); assert.equal(workload.validateConfig(c),c);
  for(const patch of [
    {authPreparation:undefined}, {version:'social-prepared-v2'},
    {authPreparation:{loginsPerSecond:0,timeoutSeconds:30}},
    {authPreparation:{loginsPerSecond:Infinity,timeoutSeconds:30}},
    {authPreparation:{loginsPerSecond:1,timeoutSeconds:0.5}},
    {authPreparation:{loginsPerSecond:5,timeoutSeconds:NaN}},
    {authPreparation:{loginsPerSecond:5,timeoutSeconds:30,concurrency:2}},
  ]) assert.throws(()=>workload.validateConfig({...prepared(),...patch}),/Invalid config/);
  assert.throws(()=>workload.validateConfig({...legacy,authPreparation:c.authPreparation}),/Invalid config/);
});

test('prepared schedule starts application time after the common barrier and staggers activation', () => {
  assert.equal(typeof workload.preparedSchedule,'function');
  const c=prepared(), at=100000;
  assert.deepEqual(workload.preparedSchedule(c,at,1),{activationAt:100000,measurementAt:103000,endAt:115000});
  assert.equal(workload.preparedSchedule(c,at,2).activationAt,100500);
  for(const ordinal of [0,3,1.5])assert.throws(()=>workload.preparedSchedule(c,at,ordinal));
  assert.throws(()=>workload.preparedSchedule(c,NaN,1));
});

test('readiness preserves native expiry without inventing issued-at or TTL claims',()=>{
  assert.equal(typeof workload.preparedTokenTiming,'function');
  assert.deepEqual(workload.preparedTokenTiming({exp:3700,iat:100},100000),{loginAtMs:100000,expiresAtMs:3700000,ttlSeconds:3600});
  assert.deepEqual(workload.preparedTokenTiming({exp:3700},100000),{loginAtMs:100000,expiresAtMs:3700000,ttlSeconds:null});
  for(const claims of [{},{exp:'3700'},{exp:NaN},{exp:90},{exp:3700,iat:null},{exp:3700,iat:3800}]){
    assert.throws(()=>workload.preparedTokenTiming(claims,100000));
  }
});

test('unbounded social entry rejects prepared config before any claim, artifact or backend access',t=>{
  const cwd=mkdtempSync(tmpdir()+'/prepared-entry-');t.after(()=>rmSync(cwd,{recursive:true}));
  const result=spawnSync(process.execPath,[resolve('scripts/social.js'),'run',resolve('configs/prepared-smoke.json')],{cwd,encoding:'utf8',env:{...process.env,PATH:'/unavailable'}});
  assert.equal(result.status,1);assert.match(result.stderr,/Prepared sessions require fresh bounded controllers/);assert.deepEqual(readdirSync(cwd),[]);
});

for(const [name,plan] of [['TrailBase',baselinePlan],['PocketBase',pocketbasePlan]])test(`${name} prepared entry is one bounded fresh point, never a legacy search`,()=>{
  const smoke=plan(['--prepared-sessions','--smoke']);
  assert.equal(smoke.preparedSessions,true);assert.equal(smoke.config.version,'social-prepared-v1');
  assert.equal(smoke.config.dataset.users,4);assert.equal(smoke.config.vus,2);
  assert.equal(smoke.runnerProfile,'4cpu-16g');assert.deepEqual(smoke.runnerBudget,{cpus:4,memoryBytes:17179869184});
  const point=plan(['--prepared-sessions','--vus=300']);
  assert.equal(point.config.vus,300);assert.equal(point.config.dataset.users,10000);assert.equal(point.campaign,undefined);assert.equal(point.search,undefined);
  for(const args of [[],['--smoke','--vus=300'],['--search'],['--lower'],['--campaign'],['--workload'],['--runner-memory=16g'],['--vus=0'],['--vus=10001'],['--vus=2.5'],['--smoke','--smoke']])assert.throws(()=>plan(['--prepared-sessions',...args]));
});
