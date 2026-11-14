import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {capture,execute,hash} from './runtime.js';
import {savePrivate} from '../src/fixtures.js';
const read=p=>JSON.parse(readFileSync(p));
export function verifyConvex(id,volume,run,point){
 const [s]=JSON.parse(capture('docker',['inspect',id]));
 assert.equal(s.Config.Labels['com.docker.compose.project'],'baas-bench-2-pilot');assert.equal(s.Config.Labels['com.docker.compose.service'],'convex');
 assert.equal(s.Config.Image,read('backends/convex/versions.json').image);assert.equal(s.State.Health.Status,'healthy');assert.equal(s.State.OOMKilled,false);assert.equal(s.RestartCount,0);
 assert.equal(s.HostConfig.NanoCpus,1000000000);assert.equal(s.HostConfig.Memory,4294967296);assert.equal(s.HostConfig.MemorySwap,4294967296);
 assert.ok(s.Mounts.some(m=>m.Name===volume&&m.Destination==='/convex/data'));
 const [v]=JSON.parse(capture('docker',['volume','inspect',volume]));assert.equal(v.Labels['baas-bench-2.convex'],run);assert.equal(v.Labels['baas-bench-2.point'],String(point));
 return s;
}
export async function prepareConvex({volume,run,point,trial,signal}){
 await execute('docker',['compose','up','-d','--wait','convex'],{timeout:180000,maxBuffer:1024*1024,signal});
 const id=capture('docker',['compose','ps','-q','convex']);verifyConvex(id,volume,run,point);
 const key=capture('docker',['compose','exec','-T','convex','./generate_admin_key.sh']);
 savePrivate(`.fixtures/archive/${run}-${point}-deployment.json`,{run,point,volume,adminKey:key},true);
 let output;
 try{output=await execute(process.execPath,[resolve('node_modules/convex/bin/main.js'),'dev','--once','--typecheck','disable','--tail-logs','disable'],{cwd:resolve('backends/convex'),env:{...process.env,CONVEX_SELF_HOSTED_URL:'http://127.0.0.1:4000',CONVEX_SELF_HOSTED_ADMIN_KEY:key,CONVEX_AGENT_MODE:'anonymous'},timeout:600000,maxBuffer:8*1024*1024,signal});}
 catch(e){output=e;throw e;}
 finally{
  const p=`.fixtures/archive/${run}-${point}-deploy.log`;writeFileSync(p,(output?.stdout??'')+'\n'+(output?.stderr??''),{mode:0o600,flag:'wx'});
  writeFileSync(`${trial}/deployment.json`,JSON.stringify({officialCli:true,adminKeyPersistedPrivately:true,adminUsedOnlyForCodeDeployment:true,deployLogSha256:hash(p),versions:read('backends/convex/versions.json')},null,2));
 }
}
export async function stopConvex({volume,run,point,trial}){
 const id=capture('docker',['compose','ps','-q','convex']);verifyConvex(id,volume,run,point);
 await execute('docker',['compose','down'],{timeout:90000,maxBuffer:1024*1024});
 assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
 writeFileSync(`${trial}/shutdown.json`,JSON.stringify({ownedShutdown:true,volumeRetained:true,run,point},null,2));
}
