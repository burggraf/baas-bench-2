import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream,readFileSync,lstatSync,readdirSync,realpathSync,mkdirSync,copyFileSync,chownSync,chmodSync,utimesSync,constants} from 'node:fs';
import {sep,dirname,resolve} from 'node:path';
import {validateConfig} from './workload.js';

const hashPattern=/^[a-f0-9]{64}$/,idPattern=/^[A-Za-z0-9_-]{22}==$/;
export function assertReadyPreparedFixture(fixture) {
  const config=validateConfig(fixture.config),recipe=config.dataset;
  assert.equal(config.version,'social-prepared-v1');assert.equal(fixture.version,1);assert.equal(fixture.status,'ready');
  assert.match(fixture.namespace,/^bench[0-9a-f]{16}$/);assert.equal(fixture.users.length,recipe.users);
  const ids=new Set(),posts=fixture.users.flatMap(user=>user.posts);
  const unique=id=>{assert.match(id,idPattern);assert.ok(!ids.has(id),'Duplicate native fixture identity');ids.add(id);};
  for(const [i,user]of fixture.users.entries()) {
    assert.equal(user.index,i);assert.equal(user.username,fixture.namespace+i);assert.ok(typeof user.password==='string'&&user.password.length>0);assert.ok(!user.deleted);
    unique(user.id);assert.equal(user.posts.length,recipe.postsPerUser);assert.equal(user.likes.length,recipe.likesPerUser);
    for(const id of user.posts)unique(id);
    for(const [j,like]of user.likes.entries()){unique(like.id);assert.equal(like.post,posts[((i+1)*recipe.postsPerUser+j)%posts.length]);}
  }
  assert.equal(fixture.baseline.users,recipe.users);assert.equal(fixture.baseline.posts,recipe.users*recipe.postsPerUser);assert.equal(fixture.baseline.likes,recipe.users*recipe.likesPerUser);assert.match(fixture.baseline.logicalHash,hashPattern);
}
function templateMetadata(fixture) {
  assertReadyPreparedFixture(fixture);const template=fixture.preparedTemplate;
  assert.equal(template?.version,1);assert.match(template.id,/^prepared-template-[A-Za-z0-9]{6}$/);assert.match(template.sourceFixtureHash,hashPattern);assert.match(template.tree.sha256,hashPattern);assert.equal(fixture.volume,template.volume);return template;
}
export function readReadyPreparedFixture(path) {
  const parent=lstatSync(dirname(path)),file=lstatSync(path);
  assert.ok(parent.isDirectory()&&!parent.isSymbolicLink()&&!(parent.mode&0o077),'Use a private fixture parent directory');
  assert.ok(file.isFile()&&!file.isSymbolicLink()&&!(file.mode&0o077),'Use a private regular fixture file');assert.equal(realpathSync(path),resolve(path),'Refuse symlinked fixture paths');
  const fixture=JSON.parse(readFileSync(path));assertReadyPreparedFixture(fixture);return fixture;
}
export function readPreparedTemplate(path) {const fixture=readReadyPreparedFixture(path);templateMetadata(fixture);return fixture;}
export function assertPreparedTemplateVolume(volume,fixture) {
  const template=templateMetadata(fixture);
  assert.equal(volume.Name,template.volume);assert.ok(volume.Name.startsWith('baas-bench-2')&&volume.Name.endsWith('_'+template.id));
  assert.equal(volume.Driver,'local');assert.equal(volume.Scope,'local');assert.ok(!volume.Options||Object.keys(volume.Options).length===0);
  assert.equal(volume.Labels?.['baas-bench-2.prepared-template'],template.id);assert.equal(volume.Labels?.['baas-bench-2.source-fixture'],template.sourceFixtureHash);
}
export function fixtureForPreparedRun(template,config,volume) {
  const metadata=templateMetadata(template);
  validateConfig(config);assert.deepEqual({...config,vus:template.config.vus},template.config,'Only execution VU count may differ from the verified template');
  assert.ok(typeof volume==='string'&&volume.length>0&&volume!==template.volume);
  const fixture=structuredClone(template);delete fixture.preparedTemplate;fixture.config=structuredClone(config);fixture.volume=volume;
  fixture.templateOrigin={id:metadata.id,volume:template.volume,treeHash:metadata.tree.sha256,sourceFixtureHash:metadata.sourceFixtureHash,sourceSeedSeconds:template.seedSeconds};
  fixture.seedSeconds=0;fixture.preparationMethod='offline-verified-template-copy';return fixture;
}
export async function preparedDirectoryDigest(directory) {
  const entries=[];let files=0,bytes=0;
  const walk=async relative=>{
    const path=relative?directory+'/'+relative:directory,stat=lstatSync(path);
    assert.ok(stat.isDirectory()||stat.isFile(),'Prepared volumes may contain only regular files/directories');
    const metadata=[relative,stat.isDirectory()?'directory':'file',stat.mode&0o7777,stat.uid,stat.gid];
    if(stat.isDirectory()){entries.push(metadata);for(const name of readdirSync(path).sort())await walk(relative?relative+'/'+name:name);}
    else{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);entries.push([...metadata,stat.size,hash.digest('hex')]);files++;bytes+=stat.size;}
  };
  await walk('');return {sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),files,bytes};
}
export async function copyPreparedDirectory(source,destination) {
  assert.ok(lstatSync(source).isDirectory()&&lstatSync(destination).isDirectory());
  const from=realpathSync(source),to=realpathSync(destination);
  assert.ok(from!==to&&!to.startsWith(from+sep)&&!from.startsWith(to+sep),'Prepared volume copies must be disjoint');
  assert.equal(readdirSync(destination).length,0,'Never overwrite a populated volume');
  const before=await preparedDirectoryDigest(source);assert.ok(before.files>0,'Refuse an empty template');
  const copy=relative=>{
    const from=relative?source+'/'+relative:source,to=relative?destination+'/'+relative:destination,stat=lstatSync(from);
    if(stat.isDirectory()){if(relative)mkdirSync(to,{mode:stat.mode&0o7777});for(const name of readdirSync(from).sort())copy(relative?relative+'/'+name:name);}
    else{assert.ok(stat.isFile());copyFileSync(from,to,constants.COPYFILE_EXCL);}
    const target=lstatSync(to);if(target.uid!==stat.uid||target.gid!==stat.gid)chownSync(to,stat.uid,stat.gid);chmodSync(to,stat.mode&0o7777);utimesSync(to,stat.atime,stat.mtime);
  };
  copy('');assert.deepEqual(await preparedDirectoryDigest(source),before,'Source changed during offline copy');assert.deepEqual(await preparedDirectoryDigest(destination),before,'Copied volume differs from source');return before;
}
