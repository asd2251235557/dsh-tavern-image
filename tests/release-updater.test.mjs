import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { createReleaseUpdater } from '../lib/release-updater.js'
import { checkPluginCompatibility } from '../lib/plugin-compatibility.js'

const API = 'https://api.github.com/repos/weixinlll/dsh-tavern-image/releases/latest'
const ZIP_URL = 'https://github.com/weixinlll/dsh-tavern-image/releases/download/v2.1.0/dsh-tavern-image-source.zip'
const SUM_URL = 'https://github.com/weixinlll/dsh-tavern-image/releases/download/v2.1.0/SHA256SUMS'
function crc32(data) { let c=0xffffffff; for(const x of data){c^=x;for(let i=0;i<8;i++)c=c>>>1^(c&1?0xedb88320:0)} return(c^0xffffffff)>>>0 }
function makeZip(entries) {
  const local=[], central=[]; let offset=0
  for(const [path,value] of Object.entries(entries)) {
    const name=Buffer.from(path), data=Buffer.from(value), packed=deflateRawSync(data), crc=crc32(data)
    const h=Buffer.alloc(30+name.length);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x808,6);h.writeUInt16LE(8,8);h.writeUInt16LE(name.length,26);name.copy(h,30);local.push(h,packed)
    const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(packed.length,8);descriptor.writeUInt32LE(data.length,12);local.push(descriptor)
    const c=Buffer.alloc(46+name.length);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x808,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);name.copy(c,46);central.push(c);offset+=h.length+packed.length+descriptor.length
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length,8);end.writeUInt16LE(central.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,cd,end])
}
async function fixture({ badHash=false, unsafePath=false, minimumApi=1, hostApi=1, localPackageName='dsh-tavern-comfy', releasePackageName='dsh-tavern-comfy' }={}) {
  const root=await mkdtemp(join(tmpdir(),'release-update-'));await mkdir(join(root,'lib'));await mkdir(join(root,'workflows'));await writeFile(join(root,'package.json'),JSON.stringify({name:localPackageName,version:'2.0.0'}));await writeFile(join(root,'lib','old.js'),'old');await writeFile(join(root,'config.json'),'private');await writeFile(join(root,'世界书-角色与服装库.json'),'old tracked seed')
  const entries={'dsh-tavern-image/package.json':JSON.stringify({name:releasePackageName,version:'2.1.0',dsh:{compatibility:{tavernApiVersion:minimumApi}}}),'dsh-tavern-image/lib/new.js':'new','dsh-tavern-image/世界书-角色与服装库.json':'new tracked seed'}
  if(unsafePath)entries[typeof unsafePath==='string'?unsafePath:'dsh-tavern-image/../../config.json']='bad'
  const zip=makeZip(entries), hash=createHash('sha256').update(zip).digest('hex'), sums=`${badHash?'0'.repeat(64):hash}  dsh-tavern-image-source.zip\n`
  const release={draft:false,prerelease:false,tag_name:'v2.1.0',assets:[{name:'dsh-tavern-image-source.zip',browser_download_url:ZIP_URL},{name:'SHA256SUMS',browser_download_url:SUM_URL}]}
  const fetchImpl=async url=>url===API?{ok:true,headers:{get:()=>null},arrayBuffer:async()=>Buffer.from(JSON.stringify(release))}:{ok:true,headers:{get:()=>null},arrayBuffer:async()=>Buffer.from(url===ZIP_URL?zip:sums)}
  const updater=createReleaseUpdater({root,fetchImpl,now:()=>42,checkCompatibility:async(pkg)=>checkPluginCompatibility(pkg,hostApi)})
  return{root,updater,fetchImpl,cleanup:()=>rm(root,{recursive:true,force:true})}
}

test('installs verified release without Git and preserves private files',async()=>{const f=await fixture();try{const checked=await f.updater.check();assert.equal(checked.canUpdate,true,JSON.stringify(checked));let calls=0;const result=await f.updater.apply(checked.target);assert.equal(result.restartRequired,true);assert.match(result.message,/完整关闭并重启/);assert.equal(await readFile(join(f.root,'lib/new.js'),'utf8'),'new');assert.equal(await readFile(join(f.root,'config.json'),'utf8'),'private');assert.equal((await f.updater.apply(checked.target)).restartRequired,true)}finally{await f.cleanup()}})
test('rejects invalid checksum without changing files',async()=>{const f=await fixture({badHash:true});try{const result=await f.updater.check();assert.equal(result.available,false);assert.match(result.reason,/SHA256/);assert.equal(await readFile(join(f.root,'lib/old.js'),'utf8'),'old')}finally{await f.cleanup()}})
test('checks compatibility on check and rejects apply when the host API is too old',async()=>{const f=await fixture({hostApi:0});try{const result=await f.updater.check();assert.equal(result.canUpdate,false);assert.match(result.reason,/API 为 v0/);await assert.rejects(f.updater.apply(result.target),/检查可用/)}finally{await f.cleanup()}})
test('rejects release updates when the host API version is unknown',async()=>{const f=await fixture({hostApi:null});try{const result=await f.updater.check();assert.equal(result.canUpdate,false);assert.match(result.reason,/未知或无效/);await assert.rejects(f.updater.apply(result.target),/检查可用/)}finally{await f.cleanup()}})
test('accepts canonical package metadata and updates the tracked seed while preserving the user outfits worldbook bytes',async()=>{const f=await fixture({releasePackageName:'dsh-tavern-image'});const config=Buffer.from('{"credentialRefs":["dsh-tavern-image:API_KEY"],"token":"private"}\r\n'),workflow=Buffer.from('{"workflow":"custom","private":"keep"}\r\n'),credential=Buffer.from([0,7,255,1,0,192]),outfits=Buffer.from('{"userOutfits":"keep byte for byte"}\r\n');try{await writeFile(join(f.root,'config.json'),config);await writeFile(join(f.root,'workflows','custom.json'),workflow);await writeFile(join(f.root,'credentials.bin'),credential);await writeFile(join(f.root,'worldbook-outfits.json'),outfits);const checked=await f.updater.check();assert.equal(checked.canUpdate,true);await f.updater.apply(checked.target);assert.equal(JSON.parse(await readFile(join(f.root,'package.json'),'utf8')).name,'dsh-tavern-image');assert.equal(await readFile(join(f.root,'世界书-角色与服装库.json'),'utf8'),'new tracked seed');assert.deepEqual(await readFile(join(f.root,'config.json')),config);assert.deepEqual(await readFile(join(f.root,'workflows','custom.json')),workflow);assert.deepEqual(await readFile(join(f.root,'credentials.bin')),credential);assert.deepEqual(await readFile(join(f.root,'worldbook-outfits.json')),outfits)}finally{await f.cleanup()}})
test('rejects unknown ZIP package names without installing files',async()=>{const f=await fixture({releasePackageName:'dsh-tavern-impostor'});try{const checked=await f.updater.check();assert.equal(checked.available,false);assert.match(checked.reason,/包名、版本/);assert.equal(await readFile(join(f.root,'lib/old.js'),'utf8'),'old')}finally{await f.cleanup()}})
test('rejects traversal ZIP path',async()=>{const f=await fixture({unsafePath:true});try{const result=await f.updater.check();assert.equal(result.available,false);assert.match(result.reason,/ZIP path/);assert.equal(await readFile(join(f.root,'config.json'),'utf8'),'private')}finally{await f.cleanup()}})
test('rolls back package.json after later symlink path failure',async()=>{const f=await fixture();try{await rm(join(f.root,'lib'),{recursive:true});await symlink(join(f.root,'outside'),join(f.root,'lib'),process.platform==='win32'?'junction':'dir');const result=await f.updater.check();await assert.rejects(f.updater.apply(result.target),/符号链接/);assert.equal(JSON.parse(await readFile(join(f.root,'package.json'),'utf8')).version,'2.0.0');assert.equal(await readFile(join(f.root,'config.json'),'utf8'),'private')}finally{await f.cleanup()}})
test('rejects a symlinked installation root',async()=>{const f=await fixture(),parent=await mkdtemp(join(tmpdir(),'release-root-')),root=join(parent,'link');await symlink(f.root,root,process.platform==='win32'?'junction':'dir');try{const updater=createReleaseUpdater({root,fetchImpl:f.fetchImpl});const state=await updater.check();assert.equal(state.available,false);assert.match(state.reason,/根目录是符号链接/)}finally{await f.cleanup();await rm(parent,{recursive:true,force:true})}})





test('passes future minimum API metadata to compatibility callback',async()=>{let values=[];const f=await fixture({minimumApi:2});try{const updater=createReleaseUpdater({root:f.root,fetchImpl:f.fetchImpl,checkCompatibility:async(pkg,api)=>{values.push(api);return{compatible:api===2}}});const checked=await updater.check();assert.equal(checked.canUpdate,true);await updater.apply(checked.target);assert.deepEqual(values,[2,2])}finally{await f.cleanup()}})
test('rejects Windows alternate-stream and reserved-device ZIP paths',async()=>{const f=await fixture({unsafePath:'dsh-tavern-image/lib/foo:stream.js'});try{const checked=await f.updater.check();assert.equal(checked.available,false);assert.match(checked.reason,/Unsafe ZIP path/)}finally{await f.cleanup()}})

test('rejects case-aliased ZIP parent directories',async()=>{const f=await fixture({unsafePath:'dsh-tavern-image/Lib/other.js'});try{const checked=await f.updater.check();assert.equal(checked.available,false);assert.match(checked.reason,/Case-conflicting/)}finally{await f.cleanup()}})
test('uses random staging directories and leaves pre-existing lookalikes untouched',async()=>{const f=await fixture();const marker=join(f.root,`.dsh-release-stage-${process.pid}-42`);await mkdir(marker);await writeFile(join(marker,'keep'),'sentinel');try{const checked=await f.updater.check();await f.updater.apply(checked.target);assert.equal(await readFile(join(marker,'keep'),'utf8'),'sentinel')}finally{await f.cleanup()}})

test('requires the checked local version to remain unchanged',async()=>{const f=await fixture();try{const checked=await f.updater.check();await writeFile(join(f.root,'package.json'),JSON.stringify({name:'dsh-tavern-comfy',version:'2.0.1'}));await assert.rejects(f.updater.apply(checked.target),/本地版本已变化/)}finally{await f.cleanup()}})
test('returns UI protocol fields and hides availability after restart',async()=>{const f=await fixture();try{const checked=await f.updater.check();assert.equal(checked.ok,true);assert.equal(checked.repositoryUrl,'https://github.com/weixinlll/dsh-tavern-image');const done=await f.updater.apply(checked.target);assert.equal(done.available,false);assert.equal(done.ok,true);assert.equal((await f.updater.status()).available,false)}finally{await f.cleanup()}})
