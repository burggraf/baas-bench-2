// Header subset exercised by the official Supabase Auth/PostgREST SDKs.
// This supplies web-platform data handling only; SDK methods remain unmodified.
export class FetchHeaders {
  constructor(init={}){this.store=new Map();if(init?.forEach)init.forEach((v,k)=>this.append(k,v));else if(Array.isArray(init))for(const [k,v]of init)this.append(k,v);else for(const [k,v]of Object.entries(init??{}))this.append(k,v);}
  key(name){const key=String(name).toLowerCase();if(!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key))throw new TypeError('Invalid header name');return key;}
  get(name){return this.store.get(this.key(name))??null;}
  has(name){return this.store.has(this.key(name));}
  set(name,value){const key=this.key(name),text=String(value).trim();if(/[\r\n]/.test(text))throw new TypeError('Invalid header value');this.store.set(key,text);}
  append(name,value){const key=this.key(name),old=this.get(key);this.set(key,old===null?value:old+', '+value);}
  delete(name){this.store.delete(this.key(name));}
  forEach(callback,that){this.store.forEach((value,key)=>callback.call(that,value,key,this));}
  entries(){return this.store.entries();}keys(){return this.store.keys();}values(){return this.store.values();}[Symbol.iterator](){return this.entries();}
}
