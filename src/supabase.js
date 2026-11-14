import {createClient} from '@supabase/supabase-js';

// Keep auth, refresh, query construction and response decoding in the official SDK.
export function supabaseClient(origin, fetch, anonKey) {
  if(!['http://127.0.0.1:4000','http://supabase:4000'].includes(origin))throw new Error('Unexpected Supabase origin');
  if(typeof anonKey!=='string'||!anonKey)throw new Error('Missing public Supabase API key');
  const sdk=createClient(origin,anonKey,{global:{fetch},db:{retry:false},auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  let session=null;
  const checked=result=>{if(result.error)throw result.error;return result.data;};
  const identity=()=>session?.user?{...session.user,username:session.user.user_metadata?.username}:null;
  const refresh=async()=>{const data=checked(await sdk.auth.refreshSession());session=data.session;return data;};
  const renew=async()=>{if(session&&session.expires_at*1000-Date.now()<=30000)await refresh();};
  const fields=name=>name==='posts'?'id,author,title,body,created_at,updated_at':'id,user,post';
  return {
    user:identity,tokens:()=>({auth_token:session?.access_token,refresh_token:session?.refresh_token}),
    async register({username,password}){if(!/^[a-zA-Z0-9]+$/.test(username))throw new Error('Invalid username');const data=checked(await sdk.auth.signUp({email:`${username}@bench.invalid`,password,options:{data:{username}}}));session=data.session;return data;},
    async login(username,password){const data=checked(await sdk.auth.signInWithPassword({email:`${username}@bench.invalid`,password}));session=data.session;return data;},
    refresh,
    async restoreSession(tokens){const data=checked(await sdk.auth.setSession({access_token:tokens.auth_token,refresh_token:tokens.refresh_token}));session=data.session;return data;},
    async refreshWithToken(refresh_token){const data=checked(await sdk.auth.refreshSession({refresh_token}));session=data.session;return data;},
    async logout(){checked(await sdk.auth.signOut({scope:'global'}));session=null;return true;},
    async deleteUser(){if(!identity())throw new Error('Missing auth');checked(await sdk.rpc('delete_own_account'));session=null;},
    records(name){
      if(!['posts','likes'].includes(name))throw new Error('Unexpected collection');
      return {
        async list({pagination:{limit=20,offset=0}={},order=[],filters=[],count=false}={}){
          if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw new Error('Unsupported pagination');
          await renew();let q=sdk.from(name).select(fields(name),count?{count:'exact'}:{});
          for(const {column,value}of filters){if(!(name==='posts'?['author']:['post','user']).includes(column)||typeof value!=='string')throw new Error('Unsupported filter');q=q.eq(column,value);}
          for(const field of order){if(!['-created_at','-id'].includes(field))throw new Error('Unsupported order');q=q.order(field.slice(1),{ascending:false});}
          const result=await q.range(offset,offset+limit-1);checked(result);return {records:result.data,...(count?{total_count:result.count}:{})};
        },
        async read(id){await renew();return checked(await sdk.from(name).select(fields(name)).eq('id',id).single());},
        async create(values){await renew();return checked(await sdk.from(name).insert(values).select('id').single()).id;},
        async createBulk(values){await renew();return checked(await sdk.from(name).insert(values).select('id')).map(row=>row.id);},
        async update(id,values){await renew();checked(await sdk.from(name).update(values).eq('id',id).select('id').single());},
        async delete(id){await renew();checked(await sdk.from(name).delete().eq('id',id).select('id').single());},
      };
    },
  };
}
