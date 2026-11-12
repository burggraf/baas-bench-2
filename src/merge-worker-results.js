import assert from 'node:assert/strict';
import {createReadStream,createWriteStream,readFileSync,writeFileSync} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {pipeline} from 'node:stream/promises';

export function quantile(values,p) {
  if(!values.length)return 0;
  const i=(values.length-1)*p,l=Math.floor(i);return values[l]+(values[Math.ceil(i)]-values[l])*(i-l);
}
const selector=key=>{const m=key.match(/^([^{}]+)(?:\{([^{}]*)\})?$/);assert.ok(m);return {base:m[1],tags:m[2]?m[2].split(',').map(x=>x.split(':')):[]};};
// Recompute distributions from original samples. Percentiles are never averaged.
export async function mergeWorkerResults(directory,config) {
  const summaries=[1,2].map(i=>JSON.parse(readFileSync(`${directory}/worker-${i}-summary.json`)));
  const keys=Object.keys(summaries[0].metrics).sort();assert.deepEqual(Object.keys(summaries[1].metrics).sort(),keys);
  const groups=new Map(),acc=new Map(),types=new Map();
  for(const key of keys){const m=summaries[0].metrics[key],base=selector(key).base;const type='passes' in m?'rate':'avg' in m?'trend':'rate' in m?'counter':'gauge';if(types.has(base))assert.equal(types.get(base),type);types.set(base,type);}
  for(const key of keys){const s=selector(key),item={key,tags:s.tags,values:[],sum:0,passes:0,count:0};acc.set(key,item);if(!groups.has(s.base))groups.set(s.base,[]);groups.get(s.base).push(item);}
  const originalTotals=[];
  for(const worker of [1,2]){
    const totals=new Map(),input=createReadStream(`${directory}/worker-${worker}-metrics.json.gz`),gzip=createGunzip(),lines=createInterface({input:input.pipe(gzip),crlfDelay:Infinity});input.on('error',e=>gzip.destroy(e));
    try{for await(const line of lines){
      const r=JSON.parse(line);if(r.type==='Metric'){assert.ok(['counter','rate','trend','gauge'].includes(r.data.type));if(types.has(r.metric))assert.equal(types.get(r.metric),r.data.type);types.set(r.metric,r.data.type);continue;}
      if(r.type!=='Point')continue;const {value,tags={}}=r.data;assert.ok(Number.isFinite(value));
      for(const item of groups.get(r.metric)??[]){if(!item.tags.every(([k,v])=>tags[k]===v))continue;
        const type=types.get(r.metric);assert.ok(type);item.count++;item.sum+=value;if(value!==0)item.passes++;
        if(type==='trend')item.values.push(value);
        const t=totals.get(item.key)??{sum:0,count:0,passes:0};t.sum+=value;t.count++;if(value!==0)t.passes++;totals.set(item.key,t);
      }
    }}finally{lines.close();input.destroy();gzip.destroy();}
    // Reject corrupt/truncated original streams even when a native summary exists.
    for(const key of keys){const native=summaries[worker-1].metrics[key],t=totals.get(key)??{sum:0,count:0,passes:0},type=types.get(selector(key).base);
      if(type==='counter')assert.equal(t.sum,native.count,key);
      if(type==='rate'){assert.equal(t.passes,native.passes,key);assert.equal(t.count-t.passes,native.fails,key);}
      if(type==='trend')assert.equal(t.count,native.count,key);
    }originalTotals.push(Object.fromEntries(totals));
  }
  const metrics={};
  for(const key of keys){const a=acc.get(key),type=types.get(selector(key).base),native=summaries.map(s=>s.metrics[key]);let m;
    if(type==='counter')m={count:a.sum,rate:native.reduce((n,r)=>n+r.rate,0)};
    else if(type==='rate')m={passes:a.passes,fails:a.count-a.passes,value:a.count?a.passes/a.count:0};
    else if(type==='trend'){a.values.sort((x,y)=>x-y);m={count:a.count,avg:a.count?a.sum/a.count:0,min:a.values[0]??0,max:a.values.at(-1)??0,med:quantile(a.values,.5),'p(90)':quantile(a.values,.9),'p(95)':quantile(a.values,.95),'p(99)':quantile(a.values,.99)};}
    else {assert.equal(type,'gauge');m={value:native.reduce((n,r)=>n+r.value,0),min:native.reduce((n,r)=>n+r.min,0),max:native.reduce((n,r)=>n+r.max,0)};}
    // k6 legacy summary threshold boolean means FAILED, not passed.
    if(native[0].thresholds)m.thresholds=Object.fromEntries(Object.keys(native[0].thresholds).map(rule=>[key==='users_finished'?`count==${config.vus}`:rule,native.some(r=>r.thresholds[rule])]));
    metrics[key]=m;
  }
  assert.equal(metrics.users_finished.count,config.vus);
  async function* streams(){for(const i of [1,2])for await(const chunk of createReadStream(`${directory}/worker-${i}-metrics.json.gz`))yield chunk;}
  await pipeline(streams(),createWriteStream(`${directory}/k6-metrics.json.gz`,{flags:'wx'}));
  writeFileSync(`${directory}/k6-summary.json`,JSON.stringify({metrics,aggregation:{workers:2,distributions:'exact-original-raw-samples',nativeThresholds:'conservative-any-worker-failure',gauges:'sum-of-worker-summaries-not-time-aligned',rawCountsVerified:true}}));
  writeFileSync(`${directory}/worker-merge.json`,JSON.stringify({workers:2,rawCountsVerified:true,usersFinished:metrics.users_finished.count,globalUsers:config.vus,percentiles:'exact-original-raw-samples',nativeThresholds:'conservative-any-worker-failure'}));
  return metrics;
}
