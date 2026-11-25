'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {Updates,isNewer,verifiedRelease,downloadInstaller}=require('../app/updates');

const bytes=Buffer.from('test package');
const release={platform:'windows-x64',version:'1.10.0',notes:'Release notes',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};

test('updates authenticate release details and compare versions numerically',()=>{
  assert.equal(isNewer('1.10.0','1.9.9'),true);
  assert.equal(isNewer('1.0.6','1.0.6'),false);
  assert.equal(isNewer('1.0.5','2.0.0'),false);
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const payload=Buffer.from(JSON.stringify(release));
  const envelope={payload:payload.toString('base64'),signature:crypto.sign(null,payload,privateKey).toString('base64')};
  assert.deepEqual(verifiedRelease(envelope,publicKey),release);
  assert.throws(()=>verifiedRelease(envelope),/signature/);
  assert.throws(()=>verifiedRelease({...envelope,payload:Buffer.from('{}').toString('base64')},publicKey),/signature/);
});

test('only the complete verified installer is retained',async t=>{
  const cache=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-update-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  for(const bad of [Buffer.from('x'),Buffer.alloc(bytes.length),Buffer.alloc(100)]){
    await assert.rejects(downloadInstaller(release,cache,()=>{},async()=>new Response(bad)));
    assert.deepEqual(await fs.readdir(cache),[]);
  }
  const percents=[];
  const file=await downloadInstaller(release,cache,p=>percents.push(p),async url=>{
    assert.ok(url.includes('/'+release.sha256+'/'));return new Response(bytes);
  });
  assert.deepEqual(await fs.readFile(file),bytes);assert.equal(percents.at(-1),100);
});

test('Later persists, manual checks override it and offline checks can be retried',async t=>{
  const envelope=await fs.readFile(path.join(__dirname,'../../web/updates/windows.json'),'utf8');
  const latest=verifiedRelease(JSON.parse(envelope));
  let visible=0,saves=0,blocked=true,offline=false;
  t.mock.method(global,'fetch',async()=>{if(offline)throw Error('offline');return new Response(envelope);});
  const preferences={};
  const deps={installed:'0.0.1',preferences,save:()=>saves++,busy:()=>blocked,change(){},show:()=>visible++};
  const first=new Updates(deps);
  await first.check();assert.equal(first.state.phase,'available');assert.equal(visible,0);
  blocked=false;first.presentIfIdle();assert.equal(visible,1);
  first.later();assert.equal(saves,1);assert.equal(first.state.phase,'idle');
  const second=new Updates(deps);await second.check();assert.equal(second.state.phase,'idle');
  await second.check(true);assert.equal(second.state.phase,'available');
  second.installed=latest.version;await second.check(true);assert.equal(second.state.phase,'current');
  offline=true;await second.check(true);assert.equal(second.state.phase,'error');
  offline=false;await second.check(true);assert.equal(second.state.phase,'current');
});

test('a connection during download postpones installation and canceled Setup keeps the host open',async t=>{
  const cache=await fs.mkdtemp(path.join(os.tmpdir(),'monitor-update-flow-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  let busy=false,quit=false,launches=0;
  t.mock.method(global,'fetch',async()=>{busy=true;return new Response(bytes);});
  const updates=new Updates({cache,preferences:{},save(){},busy:()=>busy,change(){},show(){},
    launch:async file=>{assert.deepEqual(await fs.readFile(file),bytes);return ++launches===1?'Canceled by user':'';},
    quit:()=>{quit=true;}});
  updates.release=release;updates.set('available');
  await updates.install();assert.equal(updates.state.phase,'ready');assert.equal(launches,0);
  await updates.install();assert.equal(launches,0);
  busy=false;await updates.install();assert.equal(updates.state.phase,'error');assert.equal(quit,false);
  await updates.install();assert.equal(launches,2);assert.equal(quit,true);
});

test('a manual check shows the result of an automatic check already in progress',async t=>{
  const envelope=await fs.readFile(path.join(__dirname,'../../web/updates/windows.json'),'utf8');
  let respond,requests=0;
  t.mock.method(global,'fetch',()=>{requests++;return new Promise(resolve=>{respond=resolve;});});
  const updates=new Updates({installed:verifiedRelease(JSON.parse(envelope)).version,preferences:{},show(){},change(){}});
  const background=updates.check();
  await updates.check(true);
  assert.equal(updates.state.phase,'checking');
  respond(new Response(envelope));await background;
  assert.equal(requests,1);
  assert.equal(updates.state.phase,'current');
});
