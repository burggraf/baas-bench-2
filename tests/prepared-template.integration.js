import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync,readdirSync} from 'node:fs';
import {delimiter,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {capture,hash,runtimeManifest} from '../scripts/runtime.js';
import {controllerClient} from '../scripts/client.js';
import {seedFixture,verifyFixture,savePrivate} from '../src/fixtures.js';
import {preparedDirectoryDigest} from '../src/prepared-template.js';
import {preparedTemplateControllerDirectory} from './prepared-template-output.js';
const project='baas-bench-2-pilot',read=p=>JSON.parse(readFileSync(p));
let root,sourcePath,sourceHash,sourceVolume,sourceTree,templatePath,templateHash,templateVolume,templateTree,credentials,identityHash;
const source=capture=>JSON.parse(capture('docker',['volume','inspect',sourceVolume]))[0];
const scan=(directory)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const p=directory+'/'+entry.name;if(entry.isDirectory()){scan(p);continue;}const bytes=readFileSync(p),text=(p.endsWith('.gz')?gunzipSync(bytes):bytes).toString();for(const user of credentials)assert.ok(!text.includes(user.password),'Credential leak in '+p);assert.doesNotMatch(text,/"password"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,p);}};
before(async()=>{
  const signal=new AbortController().signal;
  assert.match(process.cwd(),/\/\.fixtures\/prepared-(native|regression)-[A-Za-z0-9-]+$/);
  assert.equal(existsSync('.fixtures/trailbase.json'),false);assert.equal(existsSync('.fixtures/operation.lock'),false);
  root=mkdtempSync('results/prepared-template-native-');const suffix=root.slice(-6),run='baseline-'+suffix;sourceVolume=project+'_'+run+'-1';sourcePath='.fixtures/template-source/'+suffix+'.json';
  assert.ok(!capture('docker',['volume','ls','--format','{{.Name}}']).split('\n').includes(sourceVolume));
  capture('docker',['volume','create','--label','baas-bench-2.baseline='+run,'--label','baas-bench-2.trial=1',sourceVolume]);
  const override=root+'/source.compose.json';writeFileSync(override,JSON.stringify({volumes:{'trailbase-data':{external:true,name:sourceVolume}}}));
  const composeEnv={...process.env,COMPOSE_FILE:[resolve('compose.yaml'),resolve(override)].join(delimiter),COMPOSE_PROJECT_NAME:project,COMPOSE_PATH_SEPARATOR:delimiter};
  Object.assign(process.env,{COMPOSE_FILE:composeEnv.COMPOSE_FILE,COMPOSE_PROJECT_NAME:project,COMPOSE_PATH_SEPARATOR:delimiter});
  try{
    execFileSync('docker',['compose','up','-d','--wait','trailbase'],{env:composeEnv,stdio:'pipe',timeout:60000});
    const config=read('configs/prepared-smoke.json'),runtime=runtimeManifest(['src/fixtures.js','src/prepared-template.js','scripts/prepared-template.js','configs/prepared-smoke.json']);
    let initial=true;const persist=f=>{savePrivate(sourcePath,{...f,volume:sourceVolume,preparation:runtime},initial);initial=false;};
    const fixture=await seedFixture(config,()=>controllerClient(signal),persist);Object.assign(fixture,{volume:sourceVolume,preparation:runtime});await verifyFixture(config,fixture,()=>controllerClient(signal));persist(fixture);credentials=fixture.users;
  }finally{execFileSync('docker',['compose','down'],{env:composeEnv,stdio:'pipe',timeout:30000});for(const key of ['COMPOSE_FILE','COMPOSE_PROJECT_NAME','COMPOSE_PATH_SEPARATOR'])delete process.env[key];}
  sourceHash=hash(sourcePath);sourceTree=await preparedDirectoryDigest(source(capture).Mountpoint);
  const output=execFileSync(process.execPath,['scripts/prepared-template.js',sourcePath],{encoding:'utf8',timeout:30000});writeFileSync(root+'/import-stdout.log',output);
  const pointer=output.match(/Verified stopped template: (results\/prepared-template-[A-Za-z0-9]{6})/);assert.ok(pointer);const imported=read(pointer[1]+'/report.json');assert.equal(imported.valid,true);assert.equal(imported.apiRequests,0);assert.equal(imported.backendStarted,false);assert.equal(imported.sourcePreservationVerified,true);
  templatePath=imported.privatePath;templateHash=hash(templatePath);templateVolume=JSON.parse(capture('docker',['volume','inspect',imported.volume]))[0];templateTree=await preparedDirectoryDigest(templateVolume.Mountpoint);assert.deepEqual(templateTree,sourceTree);
  writeFileSync(root+'/source-and-template.json',JSON.stringify({sourcePath,sourceHash,sourceVolume,sourceTree,templatePath,templateHash,templateVolume:templateVolume.Name,templateTree,importDirectory:pointer[1]},null,2));
},{timeout:180000});
for(const mode of ['success-first-copy','success-second-copy','failed-login'])test('reusable prepared template '+mode,{timeout:180000},async()=>{
  const logs=mkdtempSync('results/prepared-template-case-'),original=readFileSync('src/k6/social.js','utf8'),needle='await client.login(user.username, user.password);';
  if(mode==='failed-login'){assert.equal(original.split(needle).length,2);writeFileSync('src/k6/social.js',original.replace(needle,"await client.login(user.username, currentPhase === 'preparation' && exec.vu.idInTest === 2 ? user.password + 'incorrect' : user.password);"));}
  execFileSync('npm',['run','build'],{stdio:'pipe'});
  const child=spawn(process.execPath,['scripts/baseline.js','--prepared-sessions','--smoke','--prepared-template='+templatePath],{stdio:['ignore','pipe','pipe']});let stdout='';
  child.stdout.on('data',b=>{stdout+=b;appendFileSync(logs+'/stdout.log',b);});child.stderr.on('data',b=>{stdout+=b;appendFileSync(logs+'/stderr.log',b);});const timer=setTimeout(()=>child.kill('SIGTERM'),150000);let code;
  try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
  finally{clearTimeout(timer);if(mode==='failed-login'){writeFileSync('src/k6/social.js',original);execFileSync('npm',['run','build'],{stdio:'pipe'});}}
  const pointer=preparedTemplateControllerDirectory(stdout);
  assert.ok(pointer,'Missing controller pointer; inspect '+logs);const trial=read(pointer+'/trial-1.json'),workload=trial.workload.directory,r=read(workload+'/report.json');
  assert.deepEqual(trial.template.tree,templateTree);assert.equal(trial.template.templateFileHash,templateHash);assert.notEqual(trial.volume.Name,templateVolume.Name);assert.notEqual(trial.volume.Name,sourceVolume);assert.equal(trial.preparationMethod,'offline-verified-template-copy');assert.equal(trial.seedSeconds,0);
  identityHash??=trial.identityHash;assert.equal(trial.identityHash,identityHash,'Working copies intentionally reuse baseline account identities');
  const requests=readFileSync(pointer+'/trial-1.controller-requests.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.ok(requests.length>0);assert.ok(requests.every(row=>!JSON.stringify(row).includes('register')),'Copied points must not register users');
  if(mode==='failed-login'){
    assert.notEqual(code,0);assert.equal(r.valid,false);assert.equal(r.preparation.reason,'auth_failed');assert.equal(r.end,null);assert.equal(read('.fixtures/trailbase.json').status,'used');assert.equal(trial.classification.verdict,'invalid');
    const archived='.fixtures/archive/template-failed-'+logs.slice(-6)+'.json';savePrivate(archived,read('.fixtures/trailbase.json'),true);assert.equal(hash(archived),hash('.fixtures/trailbase.json'));unlinkSync('.fixtures/trailbase.json');
  }else{
    assert.equal(code,0,'Inspect '+logs);assert.equal(r.valid,true);assert.equal(r.preparedEvidenceValid,true);assert.equal(r.participation.measuredUsers,2);assert.equal(r.participation.completedUsers,2);assert.equal(r.phaseTiming.endAt-r.phaseTiming.measurementAt,12000);assert.equal(r.authFailures,0);assert.equal(trial.classification.verdict,'pass');assert.equal(existsSync('.fixtures/trailbase.json'),false);for(const action of Object.values(r.actions)){assert.ok(action.count>0);assert.equal(action.failures,0);}
  }
  assert.equal(hash(sourcePath),sourceHash);assert.equal(hash(templatePath),templateHash);assert.deepEqual(await preparedDirectoryDigest(source(capture).Mountpoint),sourceTree);assert.deepEqual(await preparedDirectoryDigest(templateVolume.Mountpoint),templateTree);
  assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project='+project]),'');assert.equal(capture('docker',['network','ls','-q','--filter','label=com.docker.compose.project='+project]),'');assert.equal(existsSync('.fixtures/operation.lock'),false);
  scan(logs);scan(pointer);scan(workload);writeFileSync(logs+'/verified.json',JSON.stringify({verified:true,backend:'trailbase',mode:mode.startsWith('success')?'success':'failed-login',copyCase:mode,credentialsScanned:credentials.length,retainedDataUntouched:true,code,directory:pointer,workload,templateVolume:templateVolume.Name,workingVolume:trial.volume.Name,sourceUnchanged:true,templateUnchanged:true,registrationExercised:false,failedCopyRetained:mode==='failed-login'},null,2));
});
after(()=>{if(root&&credentials)scan(root);});
