import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Tokens stay private in RAM. The measured VUs always perform their own fresh password login.
export function fixtureSessions(createClient){
 const entries=new Map();let closed=false;
 const stats={passwordLogins:0,restores:0,globalSignouts:0,entries:0};
 const digest=user=>createHash('sha256').update(user.username+'\0'+user.password).digest('hex');
 const check=(client,user)=>{assert.equal(client.user()?.username,user.username);if(user.id)assert.equal(client.user()?.id,user.id);};
 const remember=(client,user)=>{check(client,user);const tokens=client.tokens();assert.ok(tokens.auth_token&&tokens.refresh_token);const previous=entries.get(user.username);entries.set(user.username,{credentialHash:digest(user),id:client.user().id,tokens,revoked:previous?.revoked===true&&previous.tokens.auth_token===tokens.auth_token});stats.entries=entries.size;};
 return {
  stats,
  async authorize(client,user){
   assert.ok(!closed,'Fixture auth context is closed');const cached=entries.get(user.username);
   if(cached){assert.equal(cached.credentialHash,digest(user),'Fixture credential changed');if(user.id)assert.equal(cached.id,user.id,'Fixture identity changed');}
   if(cached&&!cached.revoked){await client.restoreSession(cached.tokens);stats.restores++;}
   else {await client.login(user.username,user.password);stats.passwordLogins++;}
   remember(client,user);
  },
  async release(client,user){remember(client,user);return true;},
  async revokeBeforeMeasurement(){
   assert.ok(!closed);for(const entry of entries.values()){
    const client=createClient();await client.restoreSession(entry.tokens);assert.equal(client.user()?.id,entry.id);entry.tokens=client.tokens();await client.logout();entry.revoked=true;stats.globalSignouts++;
   }
  },
  async close(){
   if(closed)return;
   try{for(const entry of entries.values()){
    // Deletion may already have removed this account; callers delete retained entries explicitly.
    if(entry.revoked)continue;
    const client=createClient();await client.restoreSession(entry.tokens);await client.logout();stats.globalSignouts++;
   }}finally{entries.clear();stats.entries=0;closed=true;}
  },
  forget(user){entries.delete(user.username);stats.entries=entries.size;},
 };
}
