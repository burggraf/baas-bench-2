import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as previous from './fixtures/actions-before-bookkeeping.js';
import * as candidate from '../src/actions.js';
import {runActionScenario,actionScenario} from './helpers/action-bookkeeping.js';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

for(const version of ['social-mixed-v1','social-prepared-v1'])test(`${version} bookkeeping preserves requests, payloads, RNG consumption, failures and each state transition`,async()=>{
  for(const mode of ['normal','overflow','faults'])for(const seed of [1,2,13,47,101,999,2026,10000]){
    const options={version,mode,seed,count:256};
    const expected=await runActionScenario(previous,options),actual=await runActionScenario(candidate,options);
    assert.deepEqual(actual.steps,expected.steps,`${version}/${mode}/${seed} state/error transitions`);
    assert.deepEqual(actual.trace,expected.trace,`${version}/${mode}/${seed} exact SDK requests/payloads`);
    assert.deepEqual(actual.sdkCounts,expected.sdkCounts);assert.equal(actual.rngCalls,expected.rngCalls);assert.equal(actual.prerequisites,expected.prerequisites);
    assert.equal(digest(actual.backend),digest(expected.backend));assert.equal(digest(actual.fixture),digest(expected.fixture));
    assert.ok(actual.state.owned.length<=100&&actual.state.likes.length<=100&&actual.state.visible.length<=20);
  }
});

test('overlapping like searches keep independent candidate snapshots and release failed buffers',async()=>{
  async function exercise(implementation){
    const scenario=actionScenario({mode:'faults',seed:47}),state=implementation.initialState(scenario.user,scenario.visible,scenario.config);
    const run=()=>implementation.performAction(scenario.client,state,'like',scenario.config,scenario.rng,scenario.prerequisite);
    const settled=await Promise.allSettled([run(),run()]);
    const observations=settled.map(r=>r.status==='fulfilled'?['fulfilled']:['rejected',r.reason.message]);
    for(let i=0;i<30;i++)try{await run();observations.push(['fulfilled']);}catch(error){observations.push(['rejected',error.message]);}
    return {observations,...scenario.result(state)};
  }
  assert.deepEqual(await exercise(candidate),await exercise(previous));
});
