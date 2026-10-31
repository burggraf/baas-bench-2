import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const load = () => import('../scripts/pocketbase.js');
const rows = values => values.map(([vus, verdict]) => ({vus, verdict}));

test('PocketBase search starts300, never treats500 as an SLO failure and stops after four new points', async () => {
  const {pocketbasePlan, nextPocketbaseSearch: next} = await load();
  assert.deepEqual(pocketbasePlan(['--search']), {points:[], smoke:false, search:true});
  for (const args of [['--search','--smoke'],['--search','--lower'],['--search','--search']]) assert.throws(() => pocketbasePlan(args), /Usage/);
  let history=[];
  for (const expected of [300,400,450,475]) {
    const candidate=next(history);assert.equal(candidate.vus,expected);assert.equal(candidate.upperVus,null);assert.equal(candidate.searchCeilingVus,500);
    history.push({vus:expected,verdict:'pass'});
  }
  const end=next(history);assert.equal(end.stop,'trial_limit_reached');assert.equal(end.lowerVus,475);assert.equal(end.upperVus,null);assert.equal(end.vus,undefined);
});

test('PocketBase search refines only between an observed pass and a valid completed SLO failure', async () => {
  const {nextPocketbaseSearch: next} = await load();
  assert.equal(next(rows([[300,'slo_failure']])).vus,200);
  assert.equal(next(rows([[300,'slo_failure'],[200,'pass']])).vus,250);
  assert.equal(next(rows([[300,'slo_failure'],[200,'pass'],[250,'pass']])).vus,275);
  const end=next(rows([[300,'slo_failure'],[200,'pass'],[250,'pass'],[275,'pass']]));
  assert.equal(end.lowerVus,275);assert.equal(end.upperVus,300);assert.ok((end.upperVus-end.lowerVus)/end.lowerVus<=.1);assert.equal(end.vus,undefined);
  assert.equal(next(rows([[300,'pass'],[400,'slo_failure']])).vus,350);
});

test('PocketBase search stops on invalid/generator evidence and rejects retries or out-of-scope history', async () => {
  const {nextPocketbaseSearch: next} = await load();
  for (const verdict of ['invalid','generator_limited']) {
    const end=next([{vus:300,verdict}]);assert.equal(end.stop,verdict);assert.equal(end.vus,undefined);assert.equal(end.upperVus,null);
  }
  for(const history of [rows([[200,'pass']]), rows([[500,'slo_failure']]), rows([[300,'pass'],[300,'pass']]), rows([[300,'pass'],[400,'pass'],[450,'pass'],[475,'pass'],[480,'pass']])]) assert.throws(()=>next(history));
});

for(const mode of ['all-pass','slo-then-invalid','slo-then-safety','shutdown-failure','tampered-archive','bad-reference']) test(`PocketBase search controller ${mode} enforces bounded progression and retained failure ownership`, t=>{
  const cwd=mkdtempSync(join(tmpdir(),'pocketbase-search-'));t.after(()=>rmSync(cwd,{recursive:true}));
  for(const d of ['scripts','src','tests','configs','results/pocketbase-KLpleZ/point-100','results/social-reference'])mkdirSync(join(cwd,d),{recursive:true});
  const write=(p,value)=>writeFileSync(join(cwd,p),value),read=p=>JSON.parse(readFileSync(join(cwd,p)));
  copyFileSync('scripts/pocketbase.js',join(cwd,'scripts/pocketbase.js'));copyFileSync('configs/social-baseline.json',join(cwd,'configs/social-baseline.json'));write('package.json','{"type":"module"}');
  const hash='f6636405e2be58b44f77cc8f980e14b7c6235286c9876049615ec197ff6b840e';
  write('results/pocketbase-KLpleZ/point-100/result.json',JSON.stringify({vus:100,verdict:'pass',baseline:{logicalHash:hash},workloadDirectory:'results/social-reference'}));
  write('results/social-reference/report.json',JSON.stringify({valid:mode!=='bad-reference',resources:{valid:true},exitStatus:0}));write('results/social-reference/config.json',JSON.stringify({...read('configs/social-baseline.json'),vus:100}));
  write('src/pocketbase.js',"export const pocketbaseClient=()=>({records:()=>({list:async()=>({total_count:0})})});");write('src/workload.js','export const validateConfig=c=>c;');
  write('src/campaign.js',`export {nextCampaignTrial} from ${JSON.stringify(new URL('../src/campaign.js',import.meta.url).href)};export const campaignResourceStop=()=>null,assertHostMemoryCoverage=()=>{},campaignCpuPressure=()=>false,measurementStart=async()=>0,classifyCampaignTrial=r=>({verdict:r.verdict});`);
  write('tests/pocketbase-conformance.js','export const pocketbaseConformance=async()=>({passed:true});');write('scripts/baseline.js','export const capturePreparationEvidence=async()=>({});');
  write('scripts/monitor.js',`import{writeFileSync}from'node:fs';export const startMonitor=async d=>{writeFileSync(d+'/resources.jsonl',[0,1000].map(elapsedMs=>JSON.stringify({type:'cgroup',role:'backend',elapsedMs})).join('\\n'));return{stop:async()=>({containers:{backend:{}}})};};`);
  write('src/fixtures.js',`import{appendFileSync}from'node:fs';import{savePrivate as save}from ${JSON.stringify(new URL('../src/fixtures.js',import.meta.url).href)};
export const savePrivate=(p,v,...args)=>save(p,${JSON.stringify(mode)}==='tampered-archive'&&p.endsWith('-used.json')?{...v,status:'corrupt'}:v,...args);
export const seedFixture=async(config,client,persist)=>{appendFileSync('events.jsonl',JSON.stringify({type:'seed',vus:config.vus})+'\\n');const f={status:'ready',config,users:[],baseline:{logicalHash:${JSON.stringify(hash)}},seedSeconds:0};persist(f);return f;};
export const verifyFixture=async()=>({logicalHash:${JSON.stringify(hash)}}),deleteFixture=async f=>{appendFileSync('events.jsonl',JSON.stringify({type:'delete',vus:f.config.vus})+'\\n');};`);
  write('scripts/workload-run.js',`import{writeFileSync}from'node:fs';import{savePrivate}from ${JSON.stringify(new URL('../src/fixtures.js',import.meta.url).href)};let number=0;export const verifySizingHost=async()=>{};
export const runWorkload=async({directory,fixture,fixturePath})=>{fixture.status='used';savePrivate(fixturePath,fixture);number++;if(${JSON.stringify(mode)}==='slo-then-safety'&&number===2)throw Object.assign(new Error('private safety detail'),{name:'CampaignSafetyStop'});writeFileSync(directory+'/k6-summary.json','{}');writeFileSync(directory+'/runner-cgroups.jsonl','{}');return{verdict:${JSON.stringify(mode)}==='all-pass'?'pass':number===1?'slo_failure':'invalid'};};`);
  write('scripts/runtime.js',`import{readFileSync,appendFileSync}from'node:fs';import{createHash}from'node:crypto';let volume,point,running=false;const id='a'.repeat(64);export const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
export const runtimeManifest=()=>({runnerImageId:'fake'});export const execute=async(command,args)=>{if(args[1]==='up')running=true;if(args[1]==='down'){appendFileSync('events.jsonl',JSON.stringify({type:'down',vus:point})+'\\n');if(${JSON.stringify(mode)}==='shutdown-failure')throw Object.assign(new Error('private shutdown detail'),{name:'ShutdownFailure'});running=false;}return{stdout:'',stderr:''};};
export const capture=(command,args)=>{if(args[0]==='context')return'unix:///local';if(args[0]==='ps')return running?id:'';if(args[0]==='network')return'';if(args[0]==='volume'&&args[1]==='ls')return'';
if(args[0]==='volume'&&args[1]==='create'){volume=args.at(-1);point=Number(args.find(a=>a.startsWith('baas-bench-2.point='))?.split('=').at(-1));return volume;}
if(args[0]==='volume'&&args[1]==='inspect')return JSON.stringify([{Name:volume,Driver:'local',Scope:'local',Labels:{'baas-bench-2.pocketbase':volume.match(/pocketbase-[A-Za-z0-9]{6}/)[0],'baas-bench-2.point':String(point)}}]);
if(args[0]==='compose'&&args[1]==='ps')return id;if(args[0]==='inspect')return JSON.stringify([{Id:id,Config:{Labels:{'com.docker.compose.project':'baas-bench-2-pilot','com.docker.compose.service':'pocketbase'}},Mounts:[{Type:'volume',Name:volume,Destination:'/app/pb_data'}]}]);if(args[0]==='exec')return'Filesystem 1024-blocks Used Available Capacity Mounted on\\nx 99999999 0 99999999 0% /';throw Error('Unexpected fake command');};`);
  const result=spawnSync(process.execPath,['scripts/pocketbase.js','--search'],{cwd,encoding:'utf8',timeout:10000});assert.equal(result.status,mode==='all-pass'?0:1,result.stdout+result.stderr);
  const events=existsSync(join(cwd,'events.jsonl'))?readFileSync(join(cwd,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[],seeded=events.filter(e=>e.type==='seed').map(e=>e.vus);
  if(mode==='bad-reference'){assert.deepEqual(seeded,[]);return;}
  const folder=result.stdout.match(/PocketBase evidence: results\/(pocketbase-[A-Za-z0-9]{6});/)?.[1];assert.ok(folder,result.stdout+result.stderr);const summary=read(`results/${folder}/summary.json`);
  assert.deepEqual(seeded,mode==='all-pass'?[300,400,450,475]:mode.startsWith('slo-then-')?[300,200]:[300]);assert.deepEqual(summary.points,seeded);
  assert.equal(summary.search.upperVus,mode==='all-pass'?null:300);assert.equal(summary.search.searchCeilingVus,500);
  if(mode==='all-pass'){assert.equal(summary.completed,true);assert.equal(summary.search.lowerVus,475);assert.equal(summary.search.stop,'trial_limit_reached');assert.equal(existsSync(join(cwd,'.fixtures/pocketbase.json')),false);}
  else{assert.equal(summary.completed,false);assert.equal(existsSync(join(cwd,'.fixtures/pocketbase.json')),true);assert.equal(read('.fixtures/pocketbase.json').status,'used');assert.equal(events.some(e=>e.type==='delete'),false,'SLO-failed database must never be API-cleaned');
    if(mode.startsWith('slo-then-')){const retained=read(`results/${folder}/point-300/retained-failure.json`);assert.equal(retained.volumeRetained,true);assert.equal(retained.checkedShutdown,true);assert.equal(read(retained.archive).status,'used');assert.ok(events.findIndex(e=>e.type==='down'&&e.vus===300)<events.findIndex(e=>e.type==='seed'&&e.vus===200));assert.equal(summary.search.stop,mode==='slo-then-invalid'?'invalid':'safety_or_execution_failure');}
    if(mode==='shutdown-failure')assert.equal(existsSync(join(cwd,'.fixtures/operation.lock')),true,'Uncertain shutdown blocks further operations');
    if(mode==='tampered-archive')assert.equal(summary.failure.type,'AssertionError');
  }
  assert.equal(events.filter(e=>e.type==='down').length,seeded.length,'Every attempted backend must receive checked shutdown');
});
