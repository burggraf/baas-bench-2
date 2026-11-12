import test from 'node:test';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {existsSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,chmodSync,unlinkSync,mkdirSync} from 'node:fs';import {hash,capture} from '../scripts/runtime.js';
const read=p=>JSON.parse(readFileSync(p));
test('full prepared SDK smoke retains phase-aligned native pprof/GC evidence and cannot become a capacity pass',{timeout:180000},async()=>{
 assert.match(process.cwd(),/\/\.fixtures\/prepared-native-[A-Za-z0-9-]+$/);assert.equal(existsSync('.fixtures/trailbase.json'),false);
 const logs=mkdtempSync('results/profiling-native-'),out=[];
 const child=spawn(process.execPath,['scripts/baseline.js','--prepared-sessions','--smoke','--runner-cpus=8','--runner-memory=48g','--runner-gc=150','--payload-cache=320m','--diagnostic-profile'],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>out.push(b));const timer=setTimeout(()=>child.kill('SIGTERM'),150000);let code;
 try{code=await new Promise((ok,no)=>{child.once('error',no);child.once('close',ok);});}finally{clearTimeout(timer);writeFileSync(logs+'/native.log',Buffer.concat(out));}
 assert.equal(code,1,`Diagnostic controller must retain non-capacity result: ${logs}`);
 const pointer=Buffer.concat(out).toString().match(/inspect (results\/baseline-[A-Za-z0-9]{6})/)?.[1];assert.ok(pointer,`Missing baseline pointer: ${logs}`);
 const baseline=read(pointer+'/report.json'),trial=read(pointer+'/trial-1.json');assert.equal(baseline.diagnosticProfile,true);assert.equal(baseline.valid,false);assert.equal(baseline.capacityEligible,false);assert.equal(trial.classification.verdict,'diagnostic');assert.equal(trial.observationClassification.verdict,'pass');
 const dir=trial.workload.directory,report=read(dir+'/report.json'),profiling=read(dir+'/profiling/report.json');assert.equal(report.valid,false);assert.equal(report.workloadValid,true);assert.equal(report.preparedEvidenceValid,true);assert.equal(report.resources.valid,true);assert.equal(report.nativeChildExit.code,0);assert.equal(report.profilingOverhead,true);assert.equal(profiling.state,'complete');assert.equal(profiling.plan.cpuDurationSeconds,10);assert.equal(report.participation.measuredUsers,2);assert.equal(report.participation.completedUsers,2);
 const artifacts=profiling.jobs.flatMap(j=>j.result&&j.name!=='runtime'?Array.isArray(j.result)?j.result:[j.result]:[]);assert.equal(artifacts.length,5);
 for(const a of artifacts){const p=dir+'/profiling/'+a.file;assert.equal(hash(p),a.sha256);execFileSync('go',['tool','pprof','-top','-nodecount=3',p],{stdio:['ignore','pipe','pipe']});}
 assert.match(readFileSync(dir+'/k6-stderr.log','utf8'),/gc \d+ @/);
 const runtime=readFileSync(dir+'/profiling/runtime-metrics.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.ok(runtime.length>=10);assert.ok(runtime.every(r=>r.ok));assert.ok(runtime.some(r=>/go_gc_duration_seconds_count|go_gc_cycles/.test(r.body)));
 assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');assert.equal(existsSync('.fixtures/operation.lock'),false);
 mkdirSync('.fixtures/archive',{recursive:true,mode:0o700});
 const archive='.fixtures/archive/profiling-smoke-'+pointer.slice(-6)+'.json';copyFileSync('.fixtures/trailbase.json',archive);chmodSync(archive,0o600);assert.equal(hash(archive),hash('.fixtures/trailbase.json'));assert.equal(read(archive).status,'used');unlinkSync('.fixtures/trailbase.json');
 writeFileSync(logs+'/verified.json',JSON.stringify({code,pointer,dir,nativeExit:report.nativeChildExit.code,profileState:profiling.state,artifacts:5,capacityEligible:false,shutdownVerified:true}));console.log(`Native profiling proof: ${logs}`);
});
