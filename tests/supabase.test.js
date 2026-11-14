import test from 'node:test';import assert from 'node:assert/strict';
import {supabaseClient} from '../src/supabase.js';
import {FetchHeaders} from '../src/k6/headers.js';
import {createTransport} from '../src/k6/transport.js';
const user={id:'00000000-0000-4000-8000-000000000001',email:'alice@bench.invalid',user_metadata:{username:'alice'}};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user.id,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})+'.signature';
test('Supabase official SDK keeps isolated native sessions and constructs ordered/count-free queries',async()=>{
 const calls=[];const fetch=async(url,init)=>{calls.push({url:String(url),init});if(String(url).includes('/auth/v1/token'))return Response.json({access_token:token,refresh_token:'private-test-refresh',expires_in:3600,token_type:'bearer',user});if(String(url).includes('/auth/v1/logout'))return new Response(null,{status:204});return Response.json([{id:'post1',author:user.id,title:'t',body:'b',created_at:1,updated_at:1}],{headers:{'content-range':'0-0/1'}});};
 const a=supabaseClient('http://127.0.0.1:4000',fetch,'public-anon'),b=supabaseClient('http://127.0.0.1:4000',fetch,'public-anon');
 await a.login('alice','test-password');assert.equal(a.user().username,'alice');assert.equal(b.user(),null);
 let page=await a.records('posts').list({pagination:{limit:20,offset:40},order:['-created_at','-id'],filters:[{column:'author',value:user.id}]});
 assert.equal(page.records.length,1);assert.equal(page.total_count,undefined);
 const q=new URL(calls.at(-1).url);assert.equal(q.searchParams.get('order'),'created_at.desc,id.desc');assert.equal(q.searchParams.get('offset'),'40');assert.equal(q.searchParams.get('author'),'eq.'+user.id);
 const headers=new Headers(calls.at(-1).init.headers);assert.equal(headers.get('authorization'),'Bearer '+token);assert.equal(headers.get('prefer'),null);
 page=await a.records('posts').list({count:true});assert.equal(page.total_count,1);
 assert.equal(new Headers(calls.at(-1).init.headers).get('prefer'),'count=exact');
 await assert.rejects(a.records('posts').list({filters:[{column:'password',value:'x'}]}),/filter/);
 await a.refresh();await a.logout();assert.equal(a.user(),null);assert.ok(calls.at(-1).url.includes('/auth/v1/logout'));
});
test('Supabase transport preserves SDK headers/count responses and rejects other origins',async()=>{
 const seen=[];const t=createTransport('http://supabase:4000',async(...args)=>{seen.push(args);return {status:200,body:'[]',headers:{'Content-Range':'0-0/1'}};});
 const h=new FetchHeaders({Authorization:'Bearer test',apikey:'public'});
 const r=await t.fetch('/rest/v1/posts?select=id',{headers:h});assert.equal(seen[0][3].headers.authorization,'Bearer test');assert.equal(r.headers.get('content-range'),'0-0/1');assert.deepEqual(await r.json(),[]);
 await assert.rejects(t.fetch('http://foreign/rest/v1/posts'),/same-origin/);await assert.rejects(t.fetch('/rest/v1/../../admin'),/same-origin/);
 assert.throws(()=>new FetchHeaders({'x-test':'a\r\nb'}),/Invalid/);
});
