import {ConvexHttpClient} from 'convex/browser';
export function convexClient(origin,fetch){
 if(!['http://127.0.0.1:4000','http://convex:3210'].includes(origin))throw Error('Unexpected Convex origin');
 const sdk=new ConvexHttpClient(origin,{fetch,logger:false,skipConvexDeploymentUrlCheck:true});
 let session=null,identity=null;
 const claims=token=>JSON.parse(atob(token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));
 const install=async tokens=>{if(!tokens?.accessToken||!tokens.refreshToken)throw Error('Invalid native session');session=tokens;sdk.setAuth(tokens.accessToken);identity=await sdk.query('social:identity',{});if(identity.id!==tokens.userId)throw Error('Identity mismatch');};
 const refresh=async()=>{if(!session)throw Error('Missing session');const result=await sdk.mutation('auth:refreshSession',{refreshToken:session.refreshToken});if(result.kind!=='rotated')throw Error('Native refresh rejected');await install(result.tokens);return result;};
 const renew=async()=>{if(session&&claims(session.accessToken).exp*1000-Date.now()<=30000)await refresh();};
 const logout=async()=>{if(session)await sdk.mutation('auth:signOut',{refreshToken:session.refreshToken});sdk.clearAuth();session=null;identity=null;return true;};
 const authenticate=async(fn,args)=>{if(session)await logout();const r=await sdk.mutation(fn,args);if(r.status!=='complete')throw Object.assign(Error('Native authentication rejected'),{code:r.userError?.error??'NATIVE_AUTH_REJECTED'});await install(r.tokens);return r;};
 return {
  user:()=>identity,tokens:()=>({auth_token:session?.accessToken,refresh_token:session?.refreshToken}),
  register:args=>authenticate('auth:signUpWithUsernamePassword',args),login:(username,password)=>authenticate('auth:signInWithUsernamePassword',{username,password}),refresh,logout,
  async restoreSession(tokens){sdk.setAuth(tokens.auth_token);session={accessToken:tokens.auth_token,refreshToken:tokens.refresh_token};await renew();identity=await sdk.query('social:identity',{});session.userId=identity.id;return identity;},
  async refreshWithToken(refreshToken){sdk.clearAuth();session={refreshToken};return refresh();},
  async deleteUser(){await renew();let complete=false;for(let i=0;i<100&&!complete;i++)complete=await sdk.mutation('social:deleteOwn',{});if(!complete)throw Error('Own cleanup incomplete');sdk.clearAuth();session=null;identity=null;},
  records(table){if(!['posts','likes'].includes(table))throw Error('Invalid collection');const create=async values=>{await renew();return sdk.mutation(table==='posts'?'social:createPosts':'social:createLikes',{values});};return {
   async list({pagination:{limit=20,offset=0}={},filters=[],order=[],count=false}={}){if(order.some(x=>!['-created_at','-id'].includes(x)))throw Error('Invalid ordering');await renew();return sdk.query('social:list',{table,limit,offset,filters,count});},
   async read(id){await renew();return sdk.query('social:read',{table,id});},
   async create(values){return (await create([values]))[0];},createBulk:create,
   async update(id,values){if(table!=='posts')throw Error('Unsupported update');await renew();return sdk.mutation('social:update',{id,values});},
   async delete(id){await renew();return sdk.mutation('social:remove',{table,id});},
  };},
 };
}
