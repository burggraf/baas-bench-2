import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {groupOperation,checkGroup} from './convex-postgres-group.js';
import {resolve} from 'node:path';
import {capture,execute,hash} from './runtime.js';
import {savePrivate} from '../src/fixtures.js';
const read=p=>JSON.parse(readFileSync(p));
const project='baas-bench-2-pilot',privatePath='.fixtures/convex-postgres-deployment.json';
const owned=()=>capture('docker',['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean);
export function verifyConvex(id,volume,run,point){
 const d=read(privatePath),pins=read('backends/convex/versions.json');assert.equal(d.volume,volume);assert.equal(d.run,run);assert.equal(d.point,point);
 const backends=JSON.parse(capture('docker',['inspect',...owned()])).filter(s=>['convex','db'].includes(s.Config.Labels['com.docker.compose.service']));assert.equal(backends.length,2);
 for(const s of backends){
  assert.equal(s.Config.Labels['com.docker.compose.project'],project);assert.equal(s.HostConfig.CgroupParent,d.group);assert.equal(s.State.Health.Status,'healthy');assert.equal(s.State.OOMKilled,false);assert.equal(s.RestartCount,0);
  assert.equal(s.HostConfig.NanoCpus,1000000000);assert.equal(s.HostConfig.Memory,4294967296);assert.equal(s.HostConfig.MemorySwap,4294967296);
  assert.equal(capture('docker',['image','inspect',s.Image,'--format','{{.Architecture}}']),'arm64');
 }
 const front=backends.find(s=>s.Config.Labels['com.docker.compose.service']==='convex'),db=backends.find(s=>s.Config.Labels['com.docker.compose.service']==='db');assert.equal(front.Id,id);assert.equal(front.Config.Image,pins.image);assert.equal(db.Config.Image,pins.postgres.image);assert.ok(front.Config.Env.includes(`POSTGRES_URL=postgresql://convex:${d.password}@db:5432`),'Native backend must use the owned PostgreSQL service');assert.ok(db.Config.Env.includes('POSTGRES_DB=convex_self_hosted'),'Owned instance database must match native configuration');
 for(const [key,value]of Object.entries(pins.runtimeKnobs))assert.ok(front.Config.Env.includes(`${key}=${value}`),`Unmatched native tuning knob: ${key}`);
 assert.ok(front.Mounts.some(m=>m.Name===volume&&m.Destination==='/convex/data'));assert.ok(front.Mounts.some(m=>m.Destination==='/sys/fs/cgroup'&&m.Source.endsWith('/'+d.group)&&m.RW===false));
 assert.ok(db.Mounts.some(m=>m.Name===d.postgresVolume&&m.Destination==='/var/lib/postgresql/data'));
 for(const name of [volume,d.postgresVolume]){const [v]=JSON.parse(capture('docker',['volume','inspect',name]));assert.equal(v.Labels['baas-bench-2.convex'],run);assert.equal(v.Labels['baas-bench-2.point'],String(point));}
 const g=checkGroup(d.group);assert.equal(g.members.length,2);return front;
}
export async function prepareConvex({volume,run,point,trial,signal}){
 assert.ok(!existsSync(privatePath),'Never adopt prior deployment secrets');
 const group=`baas-bench-2-convex-postgres-${run}-${point}`,postgresVolume=volume+'-postgres',password=randomBytes(32).toString('hex');
 const d={group,postgresVolume,password,volume,run,point,groupCreated:false};savePrivate(privatePath,d,true);
 assert.equal(capture('docker',['volume','ls','-q','--filter',`name=^${postgresVolume}$`]),'');
 capture('docker',['volume','create','--label',`baas-bench-2.convex=${run}`,'--label',`baas-bench-2.point=${point}`,postgresVolume]);
 groupOperation(group,'create');d.groupCreated=true;savePrivate(privatePath,d);checkGroup(group);
 const override=read(`${trial}/compose.json`);override.volumes['convex-postgres-data']={name:postgresVolume,external:true};writeFileSync(`${trial}/compose.json`,JSON.stringify(override,null,2));
 Object.assign(process.env,{CONVEX_CGROUP:group,CONVEX_POSTGRES_PASSWORD:password});
 await execute('docker',['compose','up','-d','--wait','convex'],{timeout:180000,maxBuffer:1024*1024,signal});
 const id=capture('docker',['compose','ps','-q','convex']);verifyConvex(id,volume,run,point);
 process.env.CONVEX_BACKEND_IDS=JSON.stringify(['db','convex'].map(service=>capture('docker',['compose','ps','-q',service])));
 writeFileSync(`${trial}/aggregate-budget.json`,JSON.stringify({scope:'convex-postgres-stack',cpus:1,memoryBytes:4294967296,swapBytes:0,group,members:JSON.parse(process.env.CONVEX_BACKEND_IDS),postgresVersion:capture('docker',['compose','exec','-T','db','postgres','--version'])},null,2));
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
 const d=read(privatePath);assert.equal(d.volume,volume);assert.equal(d.run,run);assert.equal(d.point,point);
 const ids=owned();assert.ok(ids.length<=2);
 if(ids.length)for(const s of JSON.parse(capture('docker',['inspect',...ids]))){assert.ok(['convex','db'].includes(s.Config.Labels['com.docker.compose.service']));assert.equal(s.HostConfig.CgroupParent,d.group);}
 await execute('docker',['compose','down'],{timeout:90000,maxBuffer:1024*1024});assert.equal(owned().length,0);
 const group=d.groupCreated?groupOperation(d.group,'remove'):null;
 savePrivate(`.fixtures/archive/${run}-${point}-postgres.json`,d,true);unlinkSync(privatePath);
 writeFileSync(`${trial}/shutdown.json`,JSON.stringify({ownedShutdown:true,volumeRetained:true,postgresVolumeRetained:true,group,run,point},null,2));
 delete process.env.CONVEX_BACKEND_IDS;delete process.env.CONVEX_CGROUP;delete process.env.CONVEX_POSTGRES_PASSWORD;
}
