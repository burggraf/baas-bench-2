import assert from 'node:assert/strict';
import {randomBytes,createHmac} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {capture,execute,hash} from './runtime.js';
import {savePrivate} from '../src/fixtures.js';
const services=['db','auth','rest','supabase'],project='baas-bench-2-pilot';
const read=p=>JSON.parse(readFileSync(p));
const helperScript=`const fs=require('fs');const root='/host-cgroup',name=process.env.GROUP;const p=root+'/'+name;if(!/^baas-bench-2-supabase-[A-Za-z0-9-]+$/.test(name))throw Error('Invalid group');if(process.env.OP==='create'){if(fs.existsSync(p))throw Error('Never adopt an existing group');fs.writeFileSync(root+'/cgroup.subtree_control','+cpu +memory');fs.mkdirSync(p);fs.writeFileSync(p+'/cgroup.subtree_control','+cpu +memory');fs.writeFileSync(p+'/cpu.max','100000 100000');fs.writeFileSync(p+'/memory.max','4294967296');fs.writeFileSync(p+'/memory.swap.max','0');}const result={name,cpu:fs.readFileSync(p+'/cpu.max','utf8').trim(),memory:fs.readFileSync(p+'/memory.max','utf8').trim(),swap:fs.readFileSync(p+'/memory.swap.max','utf8').trim(),members:fs.readdirSync(p).filter(x=>fs.statSync(p+'/'+x).isDirectory())};if(process.env.OP==='remove'){if(result.members.length||fs.readFileSync(p+'/cgroup.procs','utf8').trim())throw Error('Group is populated');fs.rmdirSync(p);}process.stdout.write(JSON.stringify(result));`;
export function groupOperation(name,op){return JSON.parse(capture('docker',['run','--rm','--privileged','--cgroupns=host','--network','none','--memory','128m','--cpus','0.1','-v','/sys/fs/cgroup:/host-cgroup:rw','-e',`GROUP=${name}`,'-e',`OP=${op}`,'baas-bench-2-pilot-runner','node','-e',helperScript]));}
function checkGroup(name){const g=groupOperation(name,'read');assert.equal(g.cpu,'100000 100000');assert.equal(g.memory,'4294967296');assert.equal(g.swap,'0');return g;}
function deployment(){return read('.fixtures/supabase-deployment.json');}
export function verifySupabase(id,volume,run,point){
 const d=deployment();assert.equal(d.volume,volume);assert.equal(d.run,run);assert.equal(d.point,point);
 const ids=capture('docker',['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean);
 // The workload runner may also be present when this check runs at completion.
 const states=JSON.parse(capture('docker',['inspect',...ids]));const backends=states.filter(s=>services.includes(s.Config.Labels['com.docker.compose.service']));assert.equal(backends.length,4);
 for(const s of backends){assert.equal(s.HostConfig.CgroupParent,d.group);assert.equal(s.State.OOMKilled,false);assert.equal(s.RestartCount,0);assert.equal(s.State.Health.Status,'healthy');assert.equal(s.Config.Labels['com.docker.compose.project'],project);}
 const front=backends.find(s=>s.Config.Labels['com.docker.compose.service']==='supabase');assert.equal(front.Id,id);
 const db=backends.find(s=>s.Config.Labels['com.docker.compose.service']==='db');assert.ok(db.Mounts.some(m=>m.Name===volume&&m.Destination==='/var/lib/postgresql/data'));
 const v=JSON.parse(capture('docker',['volume','inspect',volume]))[0];assert.equal(v.Labels['baas-bench-2.supabase'],run);assert.equal(v.Labels['baas-bench-2.point'],String(point));
 checkGroup(d.group);return front;
}
export async function prepareSupabase({volume,run,point,trial,signal}){
 const group=`baas-bench-2-supabase-${run}-${point}`,privatePath='.fixtures/supabase-deployment.json';
 const password=randomBytes(32).toString('hex'),jwtSecret=randomBytes(48).toString('base64url');
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const content=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role:'anon',iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7*86400});
 const anonKey=content+'.'+createHmac('sha256',jwtSecret).update(content).digest('base64url');
 savePrivate(privatePath,{group,volume,run,point,password,jwtSecret,anonKey,groupCreated:false},true);
 const groupState=groupOperation(group,'create');savePrivate(privatePath,{group,volume,run,point,password,jwtSecret,anonKey,groupCreated:true});checkGroup(group);writeFileSync(`${trial}/aggregate-budget.json`,JSON.stringify(groupState,null,2));
 Object.assign(process.env,{SUPABASE_CGROUP:group,POSTGRES_PASSWORD:password,JWT_SECRET:jwtSecret,ANON_KEY:anonKey});
 const frontConfig=resolve('.fixtures/supabase-envoy.yaml');let config=readFileSync('backends/supabase/envoy.yaml','utf8');
 config=config.replaceAll('match: {prefix: /auth/v1/}',`match: {prefix: /auth/v1/, headers: [{name: apikey, string_match: {exact: '${anonKey}'}}]}`).replaceAll('match: {prefix: /rest/v1/}',`match: {prefix: /rest/v1/, headers: [{name: apikey, string_match: {exact: '${anonKey}'}}]}`);
 writeFileSync(frontConfig,config,{mode:0o600,flag:'wx'});
 const override=JSON.parse(readFileSync(`${trial}/compose.json`));override.services.supabase={volumes:[`${frontConfig}:/etc/envoy/envoy.yaml:ro`]};writeFileSync(`${trial}/compose.json`,JSON.stringify(override,null,2));
 // The only privileged SQL path provisions the application schema; fixtures use the SDK.
 await execute('docker',['compose','up','-d','--wait','supabase'],{timeout:180000,maxBuffer:1024*1024,signal});
 const db=capture('docker',['compose','ps','-q','db']);
 await execute('docker',['exec','-i',db,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',readFileSync('backends/supabase/100-social.sql','utf8')],{timeout:30000,maxBuffer:1024*1024,signal});
 const ids=services.map(s=>capture('docker',['compose','ps','-q',s]));process.env.SUPABASE_BACKEND_IDS=JSON.stringify(ids);
 writeFileSync(`${trial}/stack.json`,JSON.stringify({kind:'supabase-required-api-stack',upstreamCommit:'b046f1257110f6ac9c7fefe820bfac3ff88a3f38',aggregate:{cpus:1,memoryBytes:4294967296,swapBytes:0},group,services:services.map((service,i)=>{const s=JSON.parse(capture('docker',['inspect',ids[i]]))[0];return {service,id:s.Id,imageId:s.Image,cgroupParent:s.HostConfig.CgroupParent};}),schemaHash:hash('backends/supabase/100-social.sql'),excludedServices:['studio','realtime','storage','functions','analytics','pooler'],scope:'Only the full seven-action authenticated API workload; excluded features are not tested.'},null,2));
}
export async function stopSupabase({volume,run,point,trial}){
 const d=deployment();assert.equal(d.volume,volume);assert.equal(d.run,run);assert.equal(d.point,point);
 const ids=capture('docker',['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`]).split(/\s+/).filter(Boolean);assert.ok(ids.length<=4);
 for(const s of JSON.parse(capture('docker',['inspect',...ids]))){assert.equal(s.HostConfig.CgroupParent,d.group);assert.ok(services.includes(s.Config.Labels['com.docker.compose.service']));}

 await execute('docker',['compose','down'],{timeout:90000,maxBuffer:1024*1024});
 assert.equal(capture('docker',['ps','-aq','--filter',`label=com.docker.compose.project=${project}`]),'');
 const group=groupOperation(d.group,'remove');
 savePrivate(`.fixtures/archive/${run}-${point}-deployment.json`,d,true);assert.equal(hash('.fixtures/supabase-deployment.json'),hash(`.fixtures/archive/${run}-${point}-deployment.json`));unlinkSync('.fixtures/supabase-deployment.json');renameSync('.fixtures/supabase-envoy.yaml',`.fixtures/archive/${run}-${point}-envoy.yaml`);
 writeFileSync(`${trial}/aggregate-shutdown.json`,JSON.stringify({group,ownedShutdown:true,volumeRetained:true},null,2));
}
