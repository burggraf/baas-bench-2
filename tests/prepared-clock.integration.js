import test from 'node:test';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {existsSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
const source=readFileSync('src/k6/social.js','utf8'),block=source.slice(source.indexOf('let done = false, applicationStart = null;'),source.indexOf('\nconst phase =')),start=source.indexOf('// Initialization is outside the execution clock.'),initialization=source.slice(start,source.indexOf('  const now = clockNow;',start));
assert.ok(block.includes('clockNow')&&initialization.includes('Initialization'));
for(const mode of ['steady','interread-gap','anchor-gap','jump-forward','jump-backward'])test(`pinned k6 clock sampling: ${mode}`,{timeout:30000},async()=>{
 assert.match(process.cwd(),/\/\.fixtures\/prepared-native-[A-Za-z0-9-]+$/);const directory=mkdtempSync('results/clock-probe-'),id='social-'+directory.slice(-6),name='prepared-clock-'+directory.slice(-6);
 const probe=`import nativeExec from 'k6/execution';import {sleep} from 'k6';import * as contract from '/work/workload.js';
const createPreparedClock=contract.createPreparedClock,prepared=true,realDate=globalThis.Date;let armed=false,pending=false,offset=0,wallReads=0;
const Date={now(){wallReads++;const value=realDate.now()+offset;if(armed){pending=true;armed=false;}return value;}};
const exec={instance:{get currentTestRunDuration(){if(pending){pending=false;const b0=nativeExec.instance.currentTestRunDuration,w0=realDate.now(),a0=nativeExec.instance.currentTestRunDuration;sleep(0.15);const b1=nativeExec.instance.currentTestRunDuration,w1=realDate.now(),a1=nativeExec.instance.currentTestRunDuration,drift=Math.max(Math.abs((w1-a1)-(w0-b0)),Math.abs((w1-b1)-(w0-a0)));console.log(JSON.stringify({event:'clock_probe_gap',b0,w0,a0,b1,w1,a1,drift}));if(drift>=10)nativeExec.test.abort('probe_clock_reference_unstable');}return nativeExec.instance.currentTestRunDuration;}},test:nativeExec.test,get vu(){return nativeExec.vu;}};
${block}
export const options={scenarios:{probe:{executor:'per-vu-iterations',vus:1,iterations:1,maxDuration:'5s'}},systemTags:['scenario']};
export default function(){if(__ENV.CLOCK_MODE==='anchor-gap')armed=true;${initialization}
if(__ENV.CLOCK_MODE==='interread-gap')armed=true;if(__ENV.CLOCK_MODE==='jump-forward')offset=101;if(__ENV.CLOCK_MODE==='jump-backward')offset=-101;
const value=clockNow();if(!Number.isFinite(value))nativeExec.test.abort('invalid_probe_time');console.log(JSON.stringify({event:'clock_probe_pass',mode:__ENV.CLOCK_MODE,wallReads}));}`;
 writeFileSync(directory+'/probe.js',probe);const image=execFileSync('docker',['image','inspect','baas-bench-2-pilot-runner','--format','{{.Id}}'],{encoding:'utf8'}).trim();
 const args=['run','--rm','--name',name,'--label','baas-bench-2.clock-proof='+id,'--network','none','--cpus','4','--memory','16g','--memory-swap','16g','--user',`${process.getuid()}:${process.getgid()}`,'-e',`CLOCK_MODE=${mode}`,'-v',`${resolve(directory)}:/results/${id}`,'-v',`${resolve(directory)}/probe.js:/probe.js:ro`,...['calibration-runner.js','workload.js'].flatMap(file=>['-v',`${resolve('src/'+file)}:/work/${file}:ro`]),image,'node','/work/calibration-runner.js',id,'--profile=4cpu-16g','run','--summary-export',`/results/${id}/summary.json`,'/probe.js'];
 const logs=[],child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs.push(b));child.stderr.on('data',b=>logs.push(b));const timer=setTimeout(()=>child.kill('SIGTERM'),25000);let code;
 try{code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});}finally{clearTimeout(timer);writeFileSync(directory+'/native.log',Buffer.concat(logs));}
 assert.equal(execFileSync('docker',['ps','-aq','--filter',`name=^/${name}$`],{encoding:'utf8'}).trim(),'');
 const groups=readFileSync(directory+'/runner-cgroups.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.equal(groups.at(-1).final,true);assert.deepEqual(readFileSync(directory+'/runner-limits.txt','utf8').trim().split(/\s+/).map(Number),[400000,100000,17179869184,0]);
 writeFileSync(directory+'/outcome.json',JSON.stringify({mode,code,image,profile:'4cpu-16g',network:'none',users:1,requests:0,finalCounters:true,sourceUnchanged:true},null,2));
 assert.equal(code,mode.startsWith('jump-')?108:0,`Inspect original native clock evidence in ${directory}`);assert.equal(existsSync(directory+'/summary.json'),true);
 if(mode.startsWith('jump-'))assert.match(Buffer.concat(logs).toString(),/prepared_clock_inconsistent/);else assert.match(Buffer.concat(logs).toString(),/clock_probe_pass/);
 console.log(`Clock proof ${mode}: ${directory}`);
});
