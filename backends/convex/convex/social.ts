import {queryGeneric as query,mutationGeneric as mutation} from 'convex/server';
import {v} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {components} from './_generated/api';
const table=v.union(v.literal('posts'),v.literal('likes'));
const post=v.object({author:v.id('users'),title:v.string(),body:v.string()});
const like=v.object({user:v.id('users'),post:v.id('posts')});
const requireUser=async ctx=>{const id=await getAuthUserId(ctx);if(!id||!await ctx.db.get('users',id))throw Error('Unauthorized');return id;};
const project=row=>row.author?{id:row._id,author:row.author,title:row.title,body:row.body,created_at:row.created_at,updated_at:row.updated_at}:{id:row._id,user:row.user,post:row.post};
const checkPost=p=>{if(!p.title.length||p.title.length>120||!p.body.length||p.body.length>65536)throw Error('Invalid post');};
export const identity=query({args:{},handler:async ctx=>{const id=await requireUser(ctx);const username=await ctx.runQuery(components.authUsername.public.getUsername,{userId:id});return {id,username};}});
export const list=query({args:{table,limit:v.number(),offset:v.number(),filters:v.array(v.object({column:v.string(),value:v.string()})),count:v.boolean()},handler:async(ctx,args)=>{
 const {table,limit,offset,filters,count}=args;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0||offset>10000)throw Error('Invalid pagination');
 if(new Set(filters.map(f=>f.column)).size!==filters.length)throw Error('Duplicate filters');
 let rows,total;
 if(table==='posts'){
  if(filters.some(f=>f.column!=='author'))throw Error('Invalid filter');
  const author=filters.find(f=>f.column==='author')?.value;
  const q=author?ctx.db.query('posts').withIndex('author_feed',q=>q.eq('author',author)):ctx.db.query('posts').withIndex('feed');
  rows=(await q.order('desc').take(offset+limit)).slice(offset);
  if(count){if(author){const u=await ctx.db.get('users',author);total=u?.postCount??0;}else{total=(await ctx.db.query('users').collect()).reduce((n,u)=>n+u.postCount,0);}}
 }else{
  const uid=await requireUser(ctx);
  if(filters.some(f=>!['user','post'].includes(f.column)))throw Error('Invalid filter');
  if(filters.some(f=>f.column==='user'&&f.value!==uid))return {records:[],...(count?{total_count:0}:{})};
  const target=filters.find(f=>f.column==='post')?.value;
  const q=()=>ctx.db.query('likes').withIndex('user_post',q=>target?q.eq('user',uid).eq('post',target):q.eq('user',uid));
  rows=(await q().take(offset+limit)).slice(offset);if(count)total=(await q().collect()).length;
 }
 return {records:rows.map(project),...(count?{total_count:total}:{})};
}});
export const read=query({args:{table,id:v.string()},handler:async(ctx,{table,id})=>{const row=await ctx.db.get(table,id);if(!row)throw Error('Not found');if(table==='likes'&&row.user!==await requireUser(ctx))throw Error('Forbidden');return project(row);}});
async function insert(ctx,table,values,uid){
 if(table==='posts'){
  if(values.author!==uid)throw Error('Forbidden');checkPost(values);const now=Math.floor(Date.now()/1000);
  const id=await ctx.db.insert('posts',{...values,created_at:now,updated_at:now,sort_id:''});await ctx.db.patch('posts',id,{sort_id:id});
  const u=await ctx.db.get('users',uid);await ctx.db.patch('users',uid,{postCount:u.postCount+1});return id;
 }
 if(values.user!==uid||!await ctx.db.get('posts',values.post))throw Error('Forbidden or missing post');
 const old=await ctx.db.query('likes').withIndex('user_post',q=>q.eq('user',uid).eq('post',values.post)).unique();if(old)throw Error('Duplicate like');
 return ctx.db.insert('likes',values);
}
export const createPosts=mutation({args:{values:v.array(post)},handler:async(ctx,{values})=>{const uid=await requireUser(ctx);if(!values.length||values.length>100)throw Error('Invalid batch');const ids=[];for(const p of values)ids.push(await insert(ctx,'posts',p,uid));return ids;}});
export const createLikes=mutation({args:{values:v.array(like)},handler:async(ctx,{values})=>{const uid=await requireUser(ctx);if(!values.length||values.length>100)throw Error('Invalid batch');const ids=[];for(const l of values)ids.push(await insert(ctx,'likes',l,uid));return ids;}});
export const update=mutation({args:{id:v.id('posts'),values:v.object({title:v.optional(v.string()),body:v.optional(v.string()),author:v.optional(v.id('users'))})},handler:async(ctx,{id,values})=>{const uid=await requireUser(ctx),row=await ctx.db.get('posts',id);if(!row||row.author!==uid||values.author&&values.author!==uid)throw Error('Forbidden');checkPost({...row,...values});await ctx.db.patch('posts',id,{...values,updated_at:Math.floor(Date.now()/1000)});}});
async function removePost(ctx,row){for(const l of await ctx.db.query('likes').withIndex('post',q=>q.eq('post',row._id)).collect())await ctx.db.delete('likes',l._id);await ctx.db.delete('posts',row._id);}
export const remove=mutation({args:{table,id:v.string()},handler:async(ctx,{table,id})=>{const uid=await requireUser(ctx),row=await ctx.db.get(table,id);if(!row||(table==='posts'?row.author:row.user)!==uid)throw Error('Forbidden');if(table==='posts'){await removePost(ctx,row);const u=await ctx.db.get('users',uid);await ctx.db.patch('users',uid,{postCount:u.postCount-1});}else await ctx.db.delete('likes',id);}});
// Bounded own-account cleanup; repeat through the API until complete. No caller-selected user id.
export const deleteOwn=mutation({args:{},handler:async ctx=>{const uid=await requireUser(ctx),posts=await ctx.db.query('posts').withIndex('author_feed',q=>q.eq('author',uid)).take(20);
 for(const row of posts)await removePost(ctx,row);if(posts.length){const u=await ctx.db.get('users',uid);await ctx.db.patch('users',uid,{postCount:u.postCount-posts.length});return false;}
 const likes=await ctx.db.query('likes').withIndex('user_post',q=>q.eq('user',uid)).take(100);for(const row of likes)await ctx.db.delete('likes',row._id);if(likes.length)return false;
 const sessions=await ctx.runQuery(components.auth.public.listSessions,{userId:uid});await ctx.runMutation(components.auth.public.revokeSessions,{sessionIds:sessions.map(s=>s.sessionId)});
 await ctx.runMutation(components.authUsername.public.deleteUsername,{userId:uid});await ctx.db.delete('users',uid);return true;
}});
