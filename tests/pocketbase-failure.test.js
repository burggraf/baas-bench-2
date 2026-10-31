import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const mode of ['monitor-stop', 'uncertain-seed']) test(`PocketBase ${mode} preserves uncertainty and still shuts down the verified backend`, t => {
  const cwd = mkdtempSync(join(tmpdir(), 'pocketbase-error-'));
  t.after(() => rmSync(cwd, { recursive: true }));
  for (const dir of ['scripts', 'src', 'tests', 'configs']) mkdirSync(join(cwd, dir));
  copyFileSync('scripts/pocketbase.js', join(cwd, 'scripts/pocketbase.js'));
  copyFileSync('configs/smoke.json', join(cwd, 'configs/smoke.json'));
  writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
  const write = (path, value) => writeFileSync(join(cwd, path), value);
  write('src/pocketbase.js', 'export const pocketbaseClient=()=>({});');
  write('src/workload.js', 'export const validateConfig=c=>c;');
  write('src/campaign.js', `export {nextCampaignTrial} from ${JSON.stringify(new URL('../src/campaign.js', import.meta.url).href)}; export const campaignResourceStop=()=>null, assertHostMemoryCoverage=()=>{}, campaignCpuPressure=()=>false, classifyCampaignTrial=()=>({verdict:'pass'}), measurementStart=()=>0;`);
  write('tests/pocketbase-conformance.js', 'export const pocketbaseConformance=async()=>({passed:true});');
  write('scripts/monitor.js', `export const startMonitor=async()=>({stop:async()=>{${mode === 'monitor-stop' ? 'throw Object.assign(new Error("private monitor detail"),{name:"MonitorCleanupFailure"});' : 'return {};'}}});`);
  write('scripts/baseline.js', 'export const capturePreparationEvidence=async()=>({});');
  write('scripts/workload-run.js', 'export const verifySizingHost=async()=>{},runWorkload=async()=>{};');
  write('src/fixtures.js', `export {savePrivate} from ${JSON.stringify(new URL('../src/fixtures.js', import.meta.url).href)};
export const verifyFixture=async()=>({logicalHash:'hash'}), deleteFixture=async()=>{};
export const seedFixture=async(config,client,persist)=>{${mode === 'uncertain-seed' ? 'throw Object.assign(new Error("private seed detail"),{name:"SeedFailure",retainLock:true});' : "const f={status:'ready',config,users:[],baseline:{logicalHash:'hash'},seedSeconds:0};persist(f);return f;"}};`);
  write('scripts/runtime.js', `export {hash} from ${JSON.stringify(new URL('../scripts/runtime.js', import.meta.url).href)};import{writeFileSync}from'node:fs';
const schedule=globalThis.setTimeout,deadlines=[];
globalThis.setTimeout=(callback,milliseconds,...args)=>{if(milliseconds>=60000){deadlines.push(milliseconds);writeFileSync('preparation-deadlines.json',JSON.stringify(deadlines));}return schedule(callback,milliseconds,...args);};
let volume,running=false;const id='a'.repeat(64);
export const execute=async(command,args)=>{if(args[1]==='up')running=true;if(args[1]==='down'){running=false;writeFileSync('shutdown.json','true');}return{stdout:'',stderr:''};};
export const runtimeManifest=()=>({runnerImageId:'fake'});
export const capture=(command,args)=>{
 if(args[0]==='context')return'unix:///local';if(args[0]==='ps')return running?id:'';if(args[0]==='network')return'';
 if(args[0]==='volume'&&args[1]==='ls')return'';
 if(args[0]==='volume'&&args[1]==='create'){volume=args.at(-1);return volume;}
 if(args[0]==='volume'&&args[1]==='inspect')return JSON.stringify([{Name:volume,Driver:'local',Scope:'local',Labels:{'baas-bench-2.pocketbase':volume.match(/pocketbase-[A-Za-z0-9]{6}/)[0],'baas-bench-2.point':'2'}}]);
 if(args[0]==='compose'&&args[1]==='ps')return id;
 if(args[0]==='inspect')return JSON.stringify([{Id:id,Config:{Labels:{'com.docker.compose.project':'baas-bench-2-pilot','com.docker.compose.service':'pocketbase'}},Mounts:[{Type:'volume',Name:volume,Destination:'/app/pb_data'}]}]);
 if(args[0]==='exec')return'Filesystem 1024-blocks Used Available Capacity Mounted on\\nx 99999999 0 99999999 0% /';throw Error('Unexpected fake command');};`);
  const result = spawnSync(process.execPath, ['scripts/pocketbase.js','--smoke'], {cwd, encoding:'utf8', timeout:10000});
  assert.equal(result.status, 1, result.stdout+result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'preparation-deadlines.json'))), [120*60*1000], 'Schedule exactly one approved 120-minute preparation deadline');
  const directory = join(cwd, 'results', readdirSync(join(cwd, 'results'))[0]);
  const failure = JSON.parse(readFileSync(join(directory, 'failure.json')));
  assert.equal(failure.type, mode === 'monitor-stop' ? 'MonitorCleanupFailure' : 'SeedFailure');
  assert.equal(existsSync(join(cwd, 'shutdown.json')), true, 'Observer failure must not bypass owned-backend shutdown');
  assert.equal(existsSync(join(cwd, '.fixtures/operation.lock')), true, 'Uncertain cleanup/seed must retain the claim');
  assert.doesNotMatch(JSON.stringify(failure), /private monitor detail|private seed detail/);
});
