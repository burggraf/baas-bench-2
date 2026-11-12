import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {openSync,closeSync,writeFileSync} from 'node:fs';

// Both processes share the parent's 8CPU/48GiB cgroup and loopback gate.
export function startSegmentedWorkers(args,env,directory) {
  const aggregate=new EventEmitter(),children=[];aggregate.results=[];
  aggregate.kill=signal=>{for(const child of children)child.kill(signal);};
  const outputIndex=args.indexOf('--out'),summaryIndex=args.indexOf('--summary-export');
  assert.ok(outputIndex>=0&&summaryIndex>=0&&args[outputIndex+1]===`json=${directory}/k6-metrics.json.gz`&&args[summaryIndex+1]===`${directory}/k6-summary.json`);
  writeFileSync(`${directory}/worker-topology.json`,JSON.stringify({workers:2,sharedCgroup:true,aggregateCpus:8,aggregateMemoryGiB:48,perWorker:{GOMAXPROCS:'4',GOGC:'150',GOMEMLIMIT:'18GiB'},segments:['0:1/2','1/2:1'],sequence:'0,1/2,1',sharedGate:true}));
  for(let index=0;index<2;index++){
    const id=index+1,argv=[...args];argv[outputIndex+1]=`json=${directory}/worker-${id}-metrics.json.gz`;argv[summaryIndex+1]=`${directory}/worker-${id}-summary.json`;
    argv.push(`--execution-segment=${index===0?'0:1/2':'1/2:1'}`,'--execution-segment-sequence=0,1/2,1','--address',`127.0.0.1:${6565+index}`);
    const out=openSync(`${directory}/worker-${id}-stdout.log`,'wx'),err=openSync(`${directory}/worker-${id}-stderr.log`,'wx');
    const child=spawn('k6',argv,{env:{...env,BENCH_WORKERS:'2',GOMAXPROCS:'4',GOMEMLIMIT:'18GiB',GODEBUG:'gctrace=1'},stdio:['ignore',out,err]});children.push(child);closeSync(out);closeSync(err);
    let spawnFailed=false;child.once('error',()=>{spawnFailed=true;aggregate.kill('SIGTERM');});
    child.once('close',(code,signal)=>{
      aggregate.results[index]={worker:id,code,signal,spawnFailed};
      // Abnormal failure must stop the peer, including a peer blocked in the gate.
      if(spawnFailed||signal||![0,99].includes(code))aggregate.kill('SIGTERM');
      if(aggregate.results.filter(Boolean).length===2){
        const bad=aggregate.results.find(r=>r.spawnFailed||r.signal||![0,99].includes(r.code));
        aggregate.emit('close',bad?.code??(bad?null:aggregate.results.some(r=>r.code===99)?99:0),bad?.signal??null);
      }
    });
  }
  return aggregate;
}
