import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test('secondary evidence failure preserves the primary seed error and still shuts down only the owned backend',t=>{
  const directory=mkdtempSync(join(tmpdir(),'baseline-error-')),repo=fileURLToPath(new URL('../',import.meta.url)),id='a'.repeat(64);
  t.after(()=>rmSync(directory,{recursive:true}));
  for(const p of ['package-lock.json','compose.yaml','backends/trailbase/Dockerfile','backends/trailbase/configuration/config.textproto','backends/trailbase/configuration/migrations/main/U1792454400__social_schema.sql','src/fixtures.js','src/prepared-template.js','src/workload.js','scripts/baseline.js','scripts/client.js','scripts/runtime.js','scripts/monitor.js','configs/smoke.json']){mkdirSync(dirname(join(directory,p)),{recursive:true});copyFileSync(join(repo,p),join(directory,p));}
  writeFileSync(join(directory,'preload.mjs'),"globalThis.fetch=async()=>{throw Object.assign(new Error('private error message'),{name:'PrimarySeedFailure'});};\n");
  mkdirSync(join(directory,'bin'));
  writeFileSync(join(directory,'bin/git'),'#!/usr/bin/env node\nif(process.argv[2]===\'rev-parse\')console.log(\'1\'.repeat(40));\n',{mode:0o700});
  writeFileSync(join(directory,'bin/docker'),`#!/usr/bin/env node
const fs=require('node:fs'),a=process.argv.slice(2),p='docker-state.json';let s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):{running:false};const save=()=>fs.writeFileSync(p,JSON.stringify(s));const output=v=>console.log(typeof v==='string'?v:JSON.stringify(v));
const backend=()=>({Id:'${id}',Image:'sha256:backend',State:{Running:true,Health:{Status:'healthy'}},HostConfig:{NanoCpus:1e9,Memory:4294967296,MemorySwap:4294967296},id:'${id}',pid:42,project:'baas-bench-2-pilot',service:'trailbase',mounts:[{Type:'volume',Name:s.volume,Destination:'/app/traildepot'}],running:true,oomKilled:false,health:'healthy',restarts:0});
if(a[0]==='context')output('unix:///fake/local');
else if(a[0]==='ps') {if(s.running)output('${id}');}
else if(a[0]==='network') {}
else if(a[0]==='volume'&&a[1]==='ls') {if(s.volume)output(s.volume);}
else if(a[0]==='volume'&&a[1]==='create') {s.volume=a.at(-1);save();output(s.volume);}
else if(a[0]==='volume'&&a[1]==='inspect')output([{Name:s.volume,Driver:'local',Scope:'local',Options:null,Labels:{'baas-bench-2.baseline':s.volume.match(/baseline-[A-Za-z0-9]{6}/)[0],'baas-bench-2.trial':'1'},CreatedAt:new Date().toISOString()}]);
else if(a[0]==='compose'&&a[1]==='up'){s.running=true;save();}
else if(a[0]==='compose'&&a[1]==='down'){s.running=false;s.shutdown=true;save();}
else if(a[0]==='compose'&&a[1]==='ps')output('${id}');
else if(a[0]==='compose'&&a[1]==='exec')output(a.includes('--version')?'trail v0.35.4':{quota:100000,period:100000,memoryMax:4294967296,swapMax:0});
else if(a[0]==='inspect')output(a.includes('--format')?backend():[backend()]);
else if(a[0]==='image')output(a.at(-1).includes('.Os')?'linux/${process.arch==='x64'?'amd64':'arm64'}':'sha256:runner');
else if(a[0]==='logs'||a[0]==='exec')process.exit(1);
else process.exit(17);
`,{mode:0o700});
  const result=spawnSync(process.execPath,['--import',join(directory,'preload.mjs'),join(repo,'scripts/baseline.js'),'configs/smoke.json'],{cwd:directory,env:{...process.env,PATH:`${join(directory,'bin')}:${process.env.PATH}`},encoding:'utf8',timeout:20000});
  assert.equal(result.status,1,`${result.stdout}\n${result.stderr}`);
  const run=readdirSync(join(directory,'results')).find(n=>n.startsWith('baseline-'));assert.ok(run,`${result.stdout}\n${result.stderr}`);
  const root=join(directory,'results',run),failure=JSON.parse(readFileSync(join(root,'failure.json')));
  assert.equal(failure.type,'PrimarySeedFailure');
  const secondary=JSON.parse(readFileSync(join(root,'trial-1.cleanup-failure.json')));assert.equal(secondary.type,'PreparationEvidenceError');assert.equal(secondary.primaryType,'PrimarySeedFailure');
  assert.equal(JSON.parse(readFileSync(join(directory,'docker-state.json'))).shutdown,true);assert.equal(JSON.parse(readFileSync(join(root,'report.json'))).valid,false);assert.equal(existsSync(join(directory,'.fixtures/operation.lock')),true);
  assert.doesNotMatch(JSON.stringify(failure)+JSON.stringify(secondary),/private error message/);
});
