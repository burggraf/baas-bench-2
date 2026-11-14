import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {pocketbaseConformance} from './pocketbase-conformance.js';
export async function convexConformance(createClient){
 const shared=await pocketbaseConformance(createClient);
 const c=createClient(),username='conformance'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('base64url');
 await c.register({username,password});await c.login(username,password);
 const tokens=c.tokens(),claims=JSON.parse(Buffer.from(tokens.auth_token.split('.')[1],'base64url'));assert.equal(claims.exp-claims.iat,3600);
 await c.logout();assert.equal(c.user(),null);await assert.rejects(c.restoreSession(tokens));await assert.rejects(c.refreshWithToken(tokens.refresh_token));
 await c.login(username,password);const p=await c.records('posts').create({author:c.user().id,title:'cascade',body:'body'});
 const ids=await c.records('posts').createBulk(Array.from({length:22},(_,i)=>({author:c.user().id,title:'page'+i,body:'body'})));
 const a=await c.records('posts').list({pagination:{limit:20},order:['-created_at','-id']}),b=await c.records('posts').list({pagination:{limit:20,offset:20},order:['-created_at','-id']});
 assert.equal(a.records.length,20);assert.equal(b.records.length,3);assert.equal(new Set([...a.records,...b.records].map(r=>r.id)).size,23);
 await c.deleteUser();await assert.rejects(c.login(username,password));assert.equal((await createClient().records('posts').list({pagination:{limit:1},count:true})).total_count,0);
 return {...shared,backend:'convex',logout:'native session/refresh revocation; protected operations check live session',logoutRevocation:true,selfDeletion:'own app rows, username mapping and native session revocation; inaccessible password component hashes retained in owned volume',nativeAccessTtlSeconds:3600,stablePages:true};
}
