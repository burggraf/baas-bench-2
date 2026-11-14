import assert from 'node:assert/strict';
import {cpSync,mkdirSync,mkdtempSync,symlinkSync,readFileSync,writeFileSync,openSync,closeSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nextCampaignTrial} from '../src/campaign.js';
import {hash} from './runtime.js';
const inputs=['scripts','src','tests','configs','backends','runner','package.json','package-lock.json','compose.yaml','compose.pocketbase.yaml','compose.supabase.yaml','compose.convex.yaml'];
const read=p=>JSON.parse(readFileSync(p));
export async function runConvexCampaign(args=[]){
 assert.ok(args.length===0||args.length===1&&['--smoke-only','--start-vus=100'].includes(args[0]),'Usage: node scripts/convex-campaign.js [--smoke-only|--start-vus=100]');
 mkdirSync('results',{recursive:true});mkdirSync('.fixtures',{recursive:true,mode:0o700});
 const root=process.cwd(),directory=resolve(mkdtempSync('results/convex-campaign-')),run=directory.split('/').at(-1),history=[];
 const walk=base=>readdirSync(base,{withFileTypes:true}).flatMap(entry=>{const p=`${base}/${entry.name}`;return ['node_modules','_generated'].includes(entry.name)||entry.name.startsWith('.env')?[]:entry.isDirectory()?walk(p):/\.(js|ts|json|yaml)$/.test(p)||entry.name==='Dockerfile'?[p]:[];});
 const frozen=[...['scripts','src','tests','configs','backends','runner'].flatMap(walk),'package.json','package-lock.json','compose.yaml','compose.pocketbase.yaml','compose.supabase.yaml','compose.convex.yaml'];
 const sourceHashes=Object.fromEntries(frozen.map(p=>[p,hash(p)]));
 const limits={startVus:args.includes('--start-vus=100')?100:1000,minVus:100,maxVus:15000,maxTrials:10,precision:.05};
 let active=null,activePoint=null,status='starting',failure=null,interrupted=false,search=null;
 const save=()=>{
  writeFileSync(`${directory}/status.json`,JSON.stringify({backend:'convex',kind:'native-auth-api-capacity-campaign',status,activePoint,history,search,limits,failure,sourceHashes,updatedAt:new Date().toISOString(),pid:process.pid,certified:false},null,2));
  const rows=history.map(h=>`| ${h.vus} | ${h.phase} | ${h.verdict} | ${h.logicalActions??'unknown'} | ${h.logicalFailures??'unknown'} |`);
  writeFileSync(`${directory}/REPORT.md`,['# Convex required-API-stack capacity campaign','',`Status: **${status}**. ${activePoint?`Current: ${activePoint.vus} users (${activePoint.phase}).`:''}`,'', '| Users | Phase | Verdict | Measured actions | Failed actions |','| ---: | --- | --- | ---: | ---: |',...rows,'',search?`Search: ${JSON.stringify(search)}`:'',failure?`Stopped: ${failure.message}`:'','', 'Native Convex SQLite backend and Convex Auth share one CPU/four GiB/no swap. Nine-CPU/48-GiB generator, GC150/36-GiB soft limit and 480-MiB payload cache. Fixed 15,000-account/150,000-post/150,000-like recipe; five logins/second; 30/60/120-second application phases. Dashboard, frontend, subscriptions and file storage are excluded. Official SDK HTTP query/mutation mode; no external auth service. This is the complete seven-action authenticated API benchmark, not a full-product stress test. Single short points do not certify maximum or soak capacity. Formal generator headroom and native expiry remain separate evidence.',''].join('\n'));
 };
 const handlers=Object.fromEntries(['SIGINT','SIGTERM'].map(signal=>[signal,()=>{interrupted=true;active?.kill(signal)}]));for(const [signal,handler]of Object.entries(handlers))process.on(signal,handler);
 const heartbeat=setInterval(save,30000);
 async function point(vus,phase){
  if(interrupted||existsSync(`${directory}/stop-after-current.json`))throw new Error('Stopped at user request before another trial');
  assert.equal(execFileSync('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot'],{encoding:'utf8'}).trim(),'','Stop only inspected prior benchmark resources before starting');
  for(const [p,digest]of Object.entries(sourceHashes))assert.equal(hash(p),digest,`Input changed: ${p}`);
  const label=`${phase}-${vus}-${history.length+1}`,work=resolve(`.fixtures/prepared-point-${run}-${label}`),out=`${directory}/${label}`;mkdirSync(work,{mode:0o700});mkdirSync(out);
  for(const p of inputs)cpSync(p,`${work}/${p}`,{recursive:true});symlinkSync(resolve('node_modules'),`${work}/node_modules`);mkdirSync(`${work}/.fixtures`,{mode:0o700});mkdirSync(`${work}/results`);
  for(const [p,digest]of Object.entries(sourceHashes))assert.equal(hash(`${work}/${p}`),digest,`Snapshot changed: ${p}`);
  execFileSync('npm',['run','build'],{cwd:work,stdio:'pipe'});
  const options=['scripts/convex.js','--optimized-setup','--prepared-sessions',phase==='smoke'?'--smoke':`--vus=${vus}`,'--runner-cpus=9','--runner-memory=48g','--runner-gc=150','--payload-cache=480m'];
  activePoint={vus,phase,label,work,log:`${out}/run.log`};status='running';save();
  const fd=openSync(`${out}/run.log`,'wx');active=spawn(process.execPath,options,{cwd:work,stdio:['ignore',fd,fd]});closeSync(fd);
  const code=await new Promise((ok,no)=>{active.once('error',no);active.once('close',ok)});active=null;
  const name=readdirSync(`${work}/results`).find(n=>/^convex-[A-Za-z0-9]{6}$/.test(n));assert.ok(name,'Missing controller summary');
  const summary=read(`${work}/results/${name}/summary.json`),result=summary.history[0];
  if(!result){const safetyPath=`${work}/results/${name}/point-${vus}/safety-stop.json`;const reason=existsSync(safetyPath)?read(safetyPath).reason:summary.failure?.type??'unknown';throw new Error(`Point stopped before measurement: ${reason}; original summary ${work}/results/${name}/summary.json`);}
  const report=read(`${work}/${result.workloadDirectory}/report.json`),shutdown=execFileSync('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot'],{encoding:'utf8'}).trim()==='';
  const observation={...result,phase,controllerExit:code,shutdownVerified:shutdown,work,reportPath:`${work}/${result.workloadDirectory}/report.json`,logicalActions:Object.values(report.actions).reduce((n,a)=>n+a.count,0),logicalFailures:Object.values(report.actions).reduce((n,a)=>n+a.failures,0)};
  writeFileSync(`${out}/result.json`,JSON.stringify({observation,summary},null,2));if(phase!=='smoke')history.push(observation);activePoint=null;save();
  assert.ok(!summary.failure&&shutdown,'Controller or owned shutdown failure');assert.ok(['pass','slo_failure'].includes(result.verdict),`Unsafe or limited result: ${result.verdict}`);
  return observation;
 }
 try{
  save();const smoke=await point(2,'smoke');assert.equal(smoke.verdict,'pass','Native smoke must pass before full load');
  if(args.includes('--smoke-only')){status='smoke_passed';return {directory};}
  while(!(search=nextCampaignTrial(history.filter(h=>h.phase!=='confirm'),limits)).stop)await point(search.vus,search.phase);
  if(search.lowerVus&&search.upperVus){
   for(const vus of [search.lowerVus,search.upperVus]){const expected=vus===search.lowerVus?'pass':'slo_failure';const repeat=await point(vus,'confirm');if(repeat.verdict!==expected){status='boundary_varies_across_repeats';return {directory};}}
   status='repeated_short_run_boundary_established';
  }else if(search.stop==='search_ceiling_reached'){await point(15000,'confirm');status='dataset_ceiling_reached';}
  else status='search_stopped';
 }catch(error){if(error.message==='Stopped at user request before another trial'){status='stopped_at_user_request';}else{status='stopped_requires_evidence_review';failure={name:error.name,message:error.message};process.exitCode=1;}}
 finally{clearInterval(heartbeat);save();for(const[signal,handler]of Object.entries(handlers))process.off(signal,handler);console.log(`Convex campaign ${status}: ${directory}`);}
 return {directory};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runConvexCampaign(process.argv.slice(2));
