import http from 'k6/http';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import URL from 'core-js-pure/actual/url/index.js';
import URLSearchParams from 'core-js-pure/actual/url-search-params/index.js';
import { initClient } from 'trailbase';
import { createTransport } from './transport.js';
import { calibrationRows } from '../calibration.js';
globalThis.URL=URL;globalThis.URLSearchParams=URLSearchParams;
const rate=Number(__ENV.CALIBRATION_RATE), seconds=Number(__ENV.CALIBRATION_SECONDS), warmup=Number(__ENV.CALIBRATION_WARMUP),vus=Number(__ENV.CALIBRATION_VUS);
if(![10,25,40,100,400,1600].includes(rate)||![6,20].includes(seconds)||![2,5].includes(warmup)||![32,128].includes(vus))throw new Error('Bounded calibration configuration required');
const scenario={executor:'constant-arrival-rate',rate,timeUnit:'1s',preAllocatedVUs:vus,maxVUs:vus};
export const options={
  scenarios:{warmup:{...scenario,duration:`${warmup}s`,gracefulStop:'1s'},measure:{...scenario,startTime:`${warmup+1}s`,duration:`${seconds}s`,gracefulStop:'2s'}},
  thresholds:{calibration_failed:['rate==0'],calibration_completed:['count>0'],'dropped_iterations{scenario:measure}':['count>=0']},
  systemTags:['status','method','name','scenario','expected_response','error_code'],
};
const started=new Counter('calibration_started'),completed=new Counter('calibration_completed'),failed=new Rate('calibration_failed');
const logical=new Trend('calibration_ms',true),nonHttp=new Trend('calibration_non_http_ms',true);
const expected=calibrationRows();let httpMs=0;
const client=initClient(undefined,{transport:createTransport('http://target:4000',async(...args)=>{
  const response=await http.asyncRequest(...args);httpMs=response.timings.duration;return response;
})});
export default async function() {
  const measured=exec.scenario.name==='measure',begin=Date.now();httpMs=0;
  if(measured)started.add(1);
  let ok=false;
  try {
    const {records,...other}=await client.records('posts').list({pagination:{limit:20},order:['-created_at','-id']});
    ok=Object.keys(other).length===0 && records?.length===20 && records.every((row,i)=>Object.keys(row).length===6 && Object.keys(expected[i]).every(key=>row[key]===expected[i][key]));
  } catch { /* Record failure without retaining server bodies or errors. */ }
  failed.add(!ok);
  if(measured){const elapsed=Date.now()-begin;logical.add(elapsed);nonHttp.add(Math.max(0,elapsed-httpMs));if(ok)completed.add(1);}
}
