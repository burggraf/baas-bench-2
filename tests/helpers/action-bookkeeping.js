import {random, chooseAction, actions} from '../../src/workload.js';

const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const body = 'x'.repeat(1024);

// Deterministic API model for exact before/after request, RNG, error, mutation
// and state comparison. Native component probes use the same finite scenarios;
// they are explicitly not application or capacity benchmarks.
export function actionScenario({version='social-prepared-v1',seed=1,mode='normal'}={}) {
  const config={version,seed:20261020,dataset:{profile:'social-baseline',users:10000,postsPerUser:10,likesPerUser:10},vus:10000,rampSeconds:30,warmupSeconds:60,measurementSeconds:120,pageSize:20,bodyBytes:1024,thinkSeconds:[1,5],sessionSeconds:[300,900],weights:{listPublic:35,listOwn:15,read:15,create:5,like:17,unlike:5,edit:8},authPreparation:{loginsPerSecond:5,timeoutSeconds:2200}};
  const posts=Array.from({length:256},(_,i)=>({id:`p${String(i).padStart(3,'0')}`,author:i<150?'u1':'u2',title:`seeded ${i}`,body,created_at:i,updated_at:i}));
  const indices=mode==='overflow'?Array.from({length:150},(_,i)=>80+i):Array.from({length:25},(_,i)=>75+i);
  const likes=indices.map(i=>({id:`l${i}`,user:'u1',post:posts[i].id}));
  const user={id:'u1',index:0,posts:posts.filter(p=>p.author==='u1').map(p=>p.id).slice(mode==='overflow'?0:-10),likes:likes.slice(0,mode==='overflow'?150:7).map(l=>({id:l.id,post:l.post}))};
  const visible=posts.slice(mode==='overflow'?220:90,mode==='overflow'?240:110).map(p=>p.id);
  const trace=[],sdkCounts={},actionCounts={},errors=[],steps=[];
  let serial=0,callCount=0,rngCalls=0,prerequisites=0;
  const before=(table,method,args)=>{
    trace.push(JSON.stringify([table,method,args]));
    const key=table+'.'+method;sdkCounts[key]=(sdkCounts[key]??0)+1;callCount++;
    if(mode==='faults'&&callCount%47===0)throw Object.assign(new Error('injected_sdk_failure'),{status:503});
  };
  const missing=()=>{throw Object.assign(new Error('missing_record'),{status:404});};
  const client={records(table){
    trace.push(JSON.stringify(['records',table]));
    const rows=table==='posts'?posts:likes;
    return {
      async list(options={}) {
        before(table,'list',options);
        let selected=rows.filter(row=>(options.filters??[]).every(f=>row[f.column]===f.value));
        if(table==='posts')selected=selected.slice().sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id));
        const offset=options.pagination?.offset??0,limit=options.pagination?.limit??20;
        const records=clone(selected.slice(offset,offset+limit));
        if(mode==='faults'&&callCount%29===0&&records.length){if(table==='posts')records[0].body='short';else records[0].user='foreign';}
        return {records,...(options.count?{total_count:selected.length}:{})};
      },
      async read(id){before(table,'read',id);const row=rows.find(r=>r.id===id);if(!row)missing();return clone(row);},
      async create(fields){before(table,'create',fields);const id=`new-${++serial}`;rows.push({id,...clone(fields),...(table==='posts'?{created_at:256+serial,updated_at:256+serial}:{})});return id;},
      async update(id,fields){before(table,'update',[id,fields]);const row=rows.find(r=>r.id===id);if(!row)missing();Object.assign(row,clone(fields));},
      async delete(id){before(table,'delete',id);const index=rows.findIndex(r=>r.id===id);if(index<0)missing();rows.splice(index,1);},
    };
  }};
  const actionRng=random(seed),targetRng=random(seed+300000);
  const rng=()=>{rngCalls++;return targetRng();};
  return {config,user,visible,client,trace,sdkCounts,actionCounts,errors,steps,rng,
    action:()=>chooseAction(config.weights,actionRng),
    prerequisite:()=>{prerequisites++;trace.push('prerequisite');},
    fastPayload:(_user,sequence)=>({title:`Post 0 ${sequence}`,body}),
    result:state=>({trace,sdkCounts,actionCounts,errors,steps,rngCalls,prerequisites,state,backend:{posts,likes},fixture:{user,visible}})};
}

export async function runActionScenario(implementation,{count=256,recordSteps=true,fastPayload=false,...options}={}) {
  const scenario=actionScenario(options),state=implementation.initialState(scenario.user,scenario.visible,scenario.config);
  for(let i=0;i<count;i++){
    const action=i<actions.length?actions[i]:scenario.action();
    scenario.actionCounts[action]=(scenario.actionCounts[action]??0)+1;
    let failure=null;
    try{await implementation.performAction(scenario.client,state,action,scenario.config,scenario.rng,scenario.prerequisite,fastPayload?scenario.fastPayload:undefined);}
    catch(error){failure=[error.name,error.message,error.status??null];scenario.errors.push([i,action,...failure]);}
    if(recordSteps)scenario.steps.push([i,action,failure,JSON.stringify(state)]);
  }
  return scenario.result(state);
}
