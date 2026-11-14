import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {pocketbaseConformance} from './pocketbase-conformance.js';
export async function supabaseConformance(createClient){
 const shared=await pocketbaseConformance(createClient),c=createClient(),username='conformance'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('base64url');
 await c.register({username,password});await c.login(username,password);
 const claims=JSON.parse(Buffer.from(c.tokens().auth_token.split('.')[1],'base64url'));assert.equal(claims.exp-claims.iat,3600);
 const oldSession=c.tokens(),originalRefresh=oldSession.refresh_token;await c.logout();assert.equal(c.user(),null);
 await assert.rejects(c.refreshWithToken(originalRefresh),'Global native logout must revoke refresh sessions');
 await assert.rejects(c.restoreSession(oldSession),'Native Auth user lookup must reject a revoked session');
 await c.login(username,password);await c.deleteUser();await assert.rejects(c.login(username,password));
 return {...shared,backend:'supabase',logout:'native-global-refresh-session-revocation; access JWT retains native expiry',logoutRevocation:true,selfDeletion:'authenticated RPC restricted to auth.uid()',nativeAccessTtlSeconds:3600};
}
