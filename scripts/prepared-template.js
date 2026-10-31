import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {savePrivate} from '../src/fixtures.js';
import {readReadyPreparedFixture,assertPreparedTemplateVolume,copyPreparedDirectory,preparedDirectoryDigest} from '../src/prepared-template.js';
import {capture,hash} from './runtime.js';
const project='baas-bench-2-pilot';
const volumeState=name=>JSON.parse(capture('docker',['volume','inspect',name]))[0];
const stopped=name=>assert.equal(capture('docker',['ps','-aq','--filter',`volume=${name}`]),'','Copy only unmounted stopped volumes');
const local=volume=>{assert.equal(volume.Driver,'local');assert.equal(volume.Scope,'local');assert.ok(!volume.Options||Object.keys(volume.Options).length===0);};

async function main() {
  const args=process.argv.slice(2);assert.equal(args.length,1,'Usage: node scripts/prepared-template.js path/to/verified-ready-fixture.json');
  const sourcePath=args[0],fixture=readReadyPreparedFixture(sourcePath),sourceFixtureHash=hash(sourcePath);
  assert.equal(process.platform,'linux','Offline local-volume copying requires Linux');
  assert.ok(!process.env.COMPOSE_FILE&&!process.env.COMPOSE_PROJECT_NAME&&!process.env.DOCKER_HOST,'Use the local unmodified Docker context');
  assert.match(capture('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}']),/^unix:\/\//);
  assert.ok(!existsSync('.fixtures/operation.lock')&&!existsSync('.fixtures/recovery.lock'),'Resolve existing operation/recovery claims first');
  assert.equal(fixture.preparation.sdkVersion,JSON.parse(readFileSync('package-lock.json')).packages['node_modules/trailbase'].version);
  const source=volumeState(fixture.volume),run=source.Labels?.['baas-bench-2.baseline'];local(source);assert.match(run,/^baseline-[A-Za-z0-9]{6}$/);
  assert.equal(source.Labels['baas-bench-2.trial'],'1');assert.ok(source.Name.startsWith('baas-bench-2')&&source.Name.endsWith('_'+run+'-1'));stopped(source.Name);
  const sourceImage=JSON.parse(capture('docker',['image','inspect',fixture.preparation.backend.imageId]))[0],currentImage=JSON.parse(capture('docker',['image','inspect',project+'-trailbase']))[0];
  assert.deepEqual(currentImage.RootFS,sourceImage.RootFS,'Template and current backend filesystem must match');assert.equal(currentImage.Os,sourceImage.Os);assert.equal(currentImage.Architecture,sourceImage.Architecture);
  mkdirSync('results',{recursive:true});const directory=mkdtempSync('results/prepared-template-'),id=directory.split('/').at(-1),name=project+'_'+id;
  const report={version:1,kind:'stopped-verified-prepared-template',id,valid:false,sourceVolume:source.Name,sourceFixtureHash,sourceImageId:sourceImage.Id,currentImageId:currentImage.Id,volume:name,backendStarted:false,apiRequests:0,tokenExported:false,volumeRetained:true};
  const write=()=>writeFileSync(directory+'/report.json',JSON.stringify(report,null,2));
  savePrivate('.fixtures/operation.lock',{version:1,pid:process.pid,command:'prepared-template-import',run:id,sourceVolume:source.Name,trialVolume:name,startedAt:new Date().toISOString()},true);
  let uncertain=false;
  try {
    write();assert.ok(!capture('docker',['volume','ls','--format','{{.Name}}']).split('\n').includes(name),'Never adopt an existing template volume');
    capture('docker',['volume','create','--label','baas-bench-2.prepared-template='+id,'--label','baas-bench-2.source-fixture='+sourceFixtureHash,name]);
    const destination=volumeState(name);local(destination);assert.equal(destination.Name,name);assert.equal(destination.Labels['baas-bench-2.prepared-template'],id);assert.equal(destination.Labels['baas-bench-2.source-fixture'],sourceFixtureHash);stopped(name);
    report.sourceTree=await preparedDirectoryDigest(source.Mountpoint);write();
    const tree=await copyPreparedDirectory(source.Mountpoint,destination.Mountpoint);assert.deepEqual(tree,report.sourceTree);report.tree=tree;
    const template=structuredClone(fixture);template.volume=name;template.preparedTemplate={version:1,id,volume:name,tree,sourceFixtureHash,sourceVolume:source.Name,importedAt:new Date().toISOString()};assertPreparedTemplateVolume(destination,template);
    assert.equal(hash(sourcePath),sourceFixtureHash,'Original ready fixture changed');stopped(source.Name);
    const privatePath='.fixtures/prepared-templates/'+id+'.json';savePrivate(privatePath,template,true);report.privatePath=privatePath;report.templateFileHash=hash(privatePath);
    report.baseline=fixture.baseline;report.valid=true;write();console.log('Verified stopped template: '+directory+'; private manifest: '+privatePath+'. Original unchanged; no API traffic.');
  } catch(error) {
    report.failure={type:error.name,locations:error.stack?.split('\n').filter(line=>/^\s+at /.test(line))};throw error;
  } finally {
    try {stopped(source.Name);assert.equal(hash(sourcePath),sourceFixtureHash);if(report.sourceTree)assert.deepEqual(await preparedDirectoryDigest(source.Mountpoint),report.sourceTree);}
    catch {uncertain=true;report.sourcePreservationVerified=false;report.valid=false;}
    report.sourcePreservationVerified??=report.sourceTree?true:null;write();if(!uncertain)unlinkSync('.fixtures/operation.lock');
    assert.ok(!uncertain,'Source preservation uncertain; operation claim retained');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`Prepared template import failed (${error.name}); inspect local evidence. No automatic cleanup or volume deletion.`);process.exitCode=1;});
