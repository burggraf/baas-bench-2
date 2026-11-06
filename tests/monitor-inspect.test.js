import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startMonitor} from '../scripts/monitor.js';

for(const missingId of [false,true])test(`monitor pins discovered runner ID; missing exact ID remains an error (${missingId})`,async()=>{
  const root=mkdtempSync(join(tmpdir(),'monitor-inspect-')),directory=join(root,'social-Abc123'),bin=join(root,'bin');
  mkdirSync(directory);mkdirSync(bin);
  const backend='b'.repeat(64),runner='a'.repeat(64),oldPath=process.env.PATH;
  // Model a disappearing name alias, not a successful resource/capacity capture.
  writeFileSync(join(bin,'docker'),`#!/usr/bin/env node
import{appendFileSync,existsSync,writeFileSync}from'node:fs';
const root=${JSON.stringify(root)},args=process.argv.slice(2),target=args.at(-1),runner=${JSON.stringify(runner)},backend=${JSON.stringify(backend)};
appendFileSync(root+'/calls.jsonl',JSON.stringify(args)+'\\n');
if(args[0]!=='inspect')process.exit(2);
if(target==='social-Abc123-runner'){
 if(existsSync(root+'/seen')){process.stderr.write('error: no such object: '+target+'\\n');process.exit(1);}
 writeFileSync(root+'/seen','1');console.log(JSON.stringify({id:runner,run:'social-Abc123',status:'created',running:false,oomKilled:false,exitCode:0}));
}else if(target===runner){
 ${missingId?"process.stderr.write('error: no such object: '+target+'\\n');process.exit(1);":"console.log(JSON.stringify({id:runner,run:'social-Abc123',status:'exited',running:false,oomKilled:false,exitCode:0}));"}
}else if(target===backend)console.log(JSON.stringify({id:backend,status:'exited',running:false,oomKilled:false,exitCode:0}));else process.exit(2);
`,{mode:0o700});
  process.env.PATH=bin+':'+oldPath;
  let monitor;
  try{
    monitor=await startMonitor(directory,backend,'social-Abc123-runner');
    const deadline=Date.now()+10000;
    while(true){
      const calls=existsSync(join(root,'calls.jsonl'))?readFileSync(join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
      if(calls.filter(a=>[runner,'social-Abc123-runner'].includes(a.at(-1))).length>=2)break;
      assert.ok(Date.now()<deadline,'Second runner inspection was not observed');await delay(30);
    }
    await monitor.stop();monitor=null;
    const calls=readFileSync(join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse),targets=calls.map(a=>a.at(-1)).filter(a=>a!==backend);
    assert.equal(targets[0],'social-Abc123-runner');assert.ok(targets.length>=2);assert.ok(targets.slice(1).every(t=>t===runner),'Later inspection must use the exact discovered ID');
    const rows=readFileSync(join(directory,'resources.jsonl'),'utf8').trim().split('\n').map(JSON.parse),errors=rows.filter(r=>r.type==='error'&&r.role==='runner');
    if(missingId)assert.ok(errors.some(r=>r.operation==='inspect'));else{assert.equal(errors.length,0);assert.ok(rows.some(r=>r.type==='lifecycle'&&r.source.id===runner&&r.source.status==='exited'));}
  }finally{if(monitor)await monitor.stop();process.env.PATH=oldPath;rmSync(root,{recursive:true,force:true});}
});

for(const terminalChange of ['none','missing','restart','timeout'])test(`terminal runner is cached between polls and revalidated at stop (${terminalChange})`,{timeout:15000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'monitor-terminal-')),directory=join(root,'social-Abc123'),bin=join(root,'bin');
  mkdirSync(directory);mkdirSync(bin);
  const backend='b'.repeat(64),runner='a'.repeat(64),oldPath=process.env.PATH;
  writeFileSync(join(bin,'docker'),`#!/usr/bin/env node
import{appendFileSync,existsSync,writeFileSync}from'node:fs';
const root=${JSON.stringify(root)},args=process.argv.slice(2),target=args.at(-1),runner=${JSON.stringify(runner)},backend=${JSON.stringify(backend)};
appendFileSync(root+'/calls.jsonl',JSON.stringify(args)+'\\n');
if(args[0]!=='inspect')process.exit(2);
if(target===backend)console.log(JSON.stringify({id:backend,status:'exited',running:false,oomKilled:false,exitCode:0}));
else if(target==='social-Abc123-runner')console.log(JSON.stringify({id:runner,run:'social-Abc123',status:'created',running:false,restarts:0,oomKilled:false,exitCode:0}));
else if(target===runner){
 if(${JSON.stringify(terminalChange)}==='timeout'&&!existsSync(root+'/timed-out')){writeFileSync(root+'/timed-out','1');process.on('SIGTERM',()=>process.exit(0));process.stdout.write('partial inspector output');setInterval(()=>{},1000);await new Promise(()=>{});}
 const changed=existsSync(root+'/changed');
 if(changed&&${JSON.stringify(terminalChange)}==='missing'){process.stderr.write('No such container: '+runner+'\\n');process.exit(1);}
 const restarted=changed&&${JSON.stringify(terminalChange)}==='restart';
 console.log(JSON.stringify({id:runner,run:'social-Abc123',status:restarted?'running':'exited',running:restarted,restarts:restarted?1:0,oomKilled:false,exitCode:0}));
}else process.exit(2);
`,{mode:0o700});
  process.env.PATH=bin+':'+oldPath;let monitor;
  try{
    monitor=await startMonitor(directory,backend,'social-Abc123-runner');
    const rows=()=>readFileSync(join(directory,'resources.jsonl'),'utf8').trim().split('\n').map(JSON.parse),deadline=Date.now()+10000;
    while(!rows().some(r=>r.type==='lifecycle'&&r.role==='runner'&&r.source.status==='exited')){assert.ok(Date.now()<deadline);await delay(25);}
    writeFileSync(join(root,'changed'),'1');await delay(1250);
    const calls=()=>readFileSync(join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(a=>a[0]==='inspect'&&a.at(-1)===runner);
    assert.equal(calls().length,terminalChange==='timeout'?2:1,'A verified terminal runner needs no repeated intermediate CLI polling');
    const summary=await monitor.stop();monitor=null;assert.ok(calls().length>=(terminalChange==='timeout'?3:2),'Final inspection must still verify the actual container');
    if(terminalChange==='missing'){
      const error=rows().find(r=>r.type==='error'&&r.operation==='inspect');assert.equal(error.capture.target,runner);assert.equal(error.capture.attempts[0].exitCode,1);assert.ok(summary.issues.includes('collector_error'));
    }else if(terminalChange==='restart')assert.ok(summary.issues.includes('runner:instability'));
    else {assert.equal(rows().filter(r=>r.type==='error'&&r.role==='runner').length,0);if(terminalChange==='timeout'){const recovered=rows().find(r=>r.type==='inspection_recovered');assert.equal(recovered.capture.attempts.length,2);assert.equal(recovered.capture.attempts[0].killed,true);assert.equal(recovered.capture.attempts[0].stdout,'partial inspector output');}}
  }finally{if(monitor)await monitor.stop();process.env.PATH=oldPath;rmSync(root,{recursive:true,force:true});}
});
