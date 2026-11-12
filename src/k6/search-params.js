// TrailBase's normal list queries build empty params and append ASCII strings.
// Keep that path small; promote to the original implementation for everything else.
export function createSearchParamsConstructor(load) {
  const states=new WeakMap();
  const state=self=>{const s=states.get(self);if(!s)throw new TypeError('Invalid URLSearchParams receiver');return s;};
  const encode=s=>encodeURIComponent(s).replace(/[!'()~]|%20/g,c=>c==='%20'?'+':'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const promote=s=>s.full??=(new (load())(s.parts.join('&')));
  class URLSearchParams {
    constructor(...args){
      if(args.length&&args[0]!==undefined)return new (load())(...args);
      states.set(this,{parts:[],full:null});
    }
    static [Symbol.hasInstance](value){return Function.prototype[Symbol.hasInstance].call(this,value)||value instanceof (load());}
    append(...args){
      const s=state(this);
      if(!s.full&&args.length>=2&&typeof args[0]==='string'&&typeof args[1]==='string'&&!/[^\x00-\x7f]/.test(args[0]+args[1])){s.parts.push(encode(args[0])+'='+encode(args[1]));return;}
      return promote(s).append(...args);
    }
    toString(){const s=state(this);return s.full?s.full.toString():s.parts.join('&');}
    get size(){const s=state(this);return s.full?s.full.size:s.parts.length;}
    delete(...args){return promote(state(this)).delete(...args);}
    get(...args){return promote(state(this)).get(...args);}
    getAll(...args){return promote(state(this)).getAll(...args);}
    has(...args){return promote(state(this)).has(...args);}
    set(...args){return promote(state(this)).set(...args);}
    sort(...args){return promote(state(this)).sort(...args);}
    entries(...args){return promote(state(this)).entries(...args);}
    keys(...args){return promote(state(this)).keys(...args);}
    values(...args){return promote(state(this)).values(...args);}
    forEach(callback,thisArg){
      const full=promote(state(this));
      if(typeof callback!=='function')throw new TypeError('Expected callback');
      return full.forEach((value,key)=>callback.call(thisArg,value,key,this));
    }
    [Symbol.iterator](){return this.entries();}
    get [Symbol.toStringTag](){return 'URLSearchParams';}
  }
  return URLSearchParams;
}
