import test from 'node:test';import assert from 'node:assert/strict';
import {installURLPolyfill} from '../src/k6/transport.js';
import {createSearchParamsConstructor} from '../src/k6/search-params.js';
const Full=URLSearchParams,Fast=createSearchParamsConstructor(()=>Full);
test('ASCII SDK queries serialize identically without loading the full implementation',()=>{
 let loaded=0;const C=createSearchParamsConstructor(()=>{loaded++;return Full;});
 let seed=17;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let i=0;i<2000;i++){const a=new C(),b=new Full();for(let j=0;j<5;j++){const str=()=>Array.from({length:random()%30},()=>String.fromCharCode(random()%128)).join('');const k=str(),v=str();a.append(k,v);b.append(k,v);assert.equal(a.toString(),b.toString());assert.equal(a.size,b.size);}}
 assert.equal(loaded,0);
});
test('promotes Unicode, coercion, constructor inputs and errors to the full implementation',()=>{
 for(const input of ['a=1&a=2','?a=%ED%A0%80',[['a','x']],{a:'yes'},null,undefined])assert.equal(new Fast(input).toString(),new Full(input).toString());
 for(const value of ['中文','🙂','\ud800','\udc00',true,42,null,undefined,{toString:()=>'%xy'}]){const a=new Fast(),b=new Full();a.append('prior','a +%');b.append('prior','a +%');a.append('name',value);b.append('name',value);assert.equal(a.toString(),b.toString());a.append('after','keep');b.append('after','keep');assert.equal(a.toString(),b.toString());}
 for(const value of [Symbol('x')])assert.throws(()=>new Fast().append('key',value),TypeError);
 assert.throws(()=>new Fast().append('key'),TypeError);assert.throws(()=>Fast.prototype.toString.call({}),TypeError);
});
test('all standard operations remain live after promotion, including iterators and callback identity',()=>{
 const a=new Fast(),b=new Full();for(const p of [['z','2'],['a','1'],['a','3']]){a.append(...p);b.append(...p);}
 assert.equal(a.get('a'),b.get('a'));assert.deepEqual(a.getAll('a'),b.getAll('a'));assert.equal(a.has('a','3'),b.has('a','3'));
 a.delete('a','1');b.delete('a','1');a.set('x','unicodeé');b.set('x','unicodeé');a.sort();b.sort();assert.equal(a.toString(),b.toString());
 assert.deepEqual([...a.entries()],[...b.entries()]);assert.deepEqual([...a.keys()],[...b.keys()]);assert.deepEqual([...a.values()],[...b.values()]);
 const iterator=a.entries();a.append('zzz','last');b.append('zzz','last');assert.deepEqual([...iterator],[...b]);
 const token={};a.forEach(function(v,k,self){assert.equal(this,token);assert.equal(self,a);assert.equal(v,b.get(k));},token);
 assert.ok(a instanceof Fast);assert.ok(new Fast('a=1') instanceof Fast);assert.equal(Object.prototype.toString.call(a),'[object URLSearchParams]');
});

test('URL dependency feature detection cannot reenter the deferred URL constructor',()=>{
 let loads=0;const target={},URL=function URL(){};const shield=installURLPolyfill(()=>{loads++;return URL;},target);
 assert.equal(shield(()=>target.URL),undefined);assert.equal(loads,0);assert.throws(()=>shield(()=>{throw new Error('dependency failed');}));assert.equal(loads,0);assert.equal(target.URL,URL);assert.equal(loads,1);assert.equal(shield(()=>target.URL),URL);
});
