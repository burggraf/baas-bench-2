// Isolated native correctness check. Its caller configures a three-second native
// access TTL in a private source snapshot; no benchmark uses that override.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {resolve,delimiter} from 'node:path';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {ConvexHttpClient} from 'convex/browser';
import {convexClient} from '../src/convex.js';
import {prepareConvex,stopConvex} from '../scripts/convex-deployment.js';
import {capture} from '../scripts/runtime.js';
const dir=mkdtempSync('results/convex-expiry-'),run=dir.split('/').at(-1),volume=`baas-bench-2-pilot_${run}`,point=1;
assert.equal(capture('docker',['ps','-aq','--filter','label=com.docker.compose.project=baas-bench-2-pilot']),'');
mkdirSync('.fixtures/archive',{recursive:true,mode:0o700});
capture('docker',['volume','create','--label',`baas-bench-2.convex=${run}`,'--label','baas-bench-2.point=1',volume]);
const override=dir+'/compose.json';writeFileSync(override,JSON.stringify({volumes:{'convex-data':{name:volume,external:true}}}));
Object.assign(process.env,{COMPOSE_FILE:[resolve('compose.convex.yaml'),resolve(override)].join(delimiter),COMPOSE_PROJECT_NAME:'baas-bench-2-pilot',COMPOSE_PATH_SEPARATOR:delimiter});
let failure;
try{
 await prepareConvex({volume,run,point,trial:dir,signal:new AbortController().signal});
 const origin='http://127.0.0.1:4000',create=()=>convexClient(origin,(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)}));
 const c=create(),username='expiry'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('base64url');
 await c.register({username,password});const identity=c.user(),tokens=c.tokens();
 const claims=JSON.parse(Buffer.from(tokens.auth_token.split('.')[1],'base64url'));assert.equal(claims.exp-claims.iat,3);
 const raw=new ConvexHttpClient(origin,{logger:false,auth:tokens.auth_token});
 let rejected=false;
 for(let i=0;i<80&&!rejected;i++){await new Promise(r=>setTimeout(r,1000));try{await raw.query('social:identity',{});}catch{rejected=true;}}
 assert.ok(rejected,'Native server must reject the genuinely expired token before testing refresh');
 const fresh=create();await fresh.restoreSession(tokens);assert.equal(fresh.user().id,identity.id);assert.notEqual(fresh.tokens().auth_token,tokens.auth_token);
 await fresh.records('likes').list({pagination:{limit:1}});
 await fresh.refresh();assert.equal(fresh.user().id,identity.id);const renewed=fresh.tokens();await fresh.logout();await assert.rejects(create().restoreSession(renewed));
 const cleanup=create();await cleanup.login(username,password);await cleanup.deleteUser();
 writeFileSync(dir+'/verification.json',JSON.stringify({passed:true,capacityEligible:false,nativeAccessTtlSeconds:3,nativeExpiredAccessRejected:true,nativeRefreshAfterExpiry:true,identityPreserved:true,protectedRead:true,logoutRevocation:true,tokensPersisted:false},null,2));
}catch(e){failure=e;writeFileSync(dir+'/failure.json',JSON.stringify({name:e.name,code:e.code??null,message:e.message},null,2));}
finally{await stopConvex({volume,run,point,trial:dir});}
if(failure)throw failure;
