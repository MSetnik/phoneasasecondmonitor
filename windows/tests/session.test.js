const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {Sharing,layout}=require('../app/server');
test('folded and unfolded viewports, malformed headers and refresh targets',()=>{
 assert.deepEqual(layout('884x832@2',120),{width:1768,height:1664,fps:120});
 assert.deepEqual(layout('0x0@0',1),{width:1280,height:720,fps:60});
 assert.equal(layout('1500x800@3',90).width,2560);
});
test('a LAN viewer must pair, obtain desktop approval and receive its own input grant',async t=>{
 let left=1200,input=0,stopped=0;
 const share=new Sharing({remaining:()=>left,changed(){},startMedia:async size=>size,stopMedia(){stopped++;},
   sendInput:async()=>{input++;return {status:204};},media:async op=>op==='jpeg'?Uint8Array.from([255,216,255,217]):null});
 await share.listen('127.0.0.1',0,path.resolve(__dirname,'../../viewer'));t.after(()=>share.close());
 const url='http://'+share.address;
 const call=(path,method='GET',headers={},body)=>fetch(url+path,{method,headers,body});
 assert.equal((await call('/')).status,200);
 assert.equal((await call('/frame')).status,403);
 assert.equal((await call('/pair','POST',{'X-Pair-Code':share.code,Origin:'http://other.invalid'})).status,403);
 assert.equal((await call('/pair','POST',{'X-Pair-Code':'no'})).status,403);
 const pair=await call('/pair','POST',{'X-Pair-Code':share.code});assert.equal(pair.status,200);
 const auth={Authorization:'Bearer '+await pair.text()};
 assert.equal((await call('/frame','GET',auth)).status,202);
 assert.equal((await call('/keyboard','POST',auth,'{}')).status,403);
 await share.approve(true);
 const frame=await call('/frame','GET',auth);assert.equal(frame.status,200);assert.equal(frame.headers.get('X-Demo-Remaining'),'1200');
 const grant=frame.headers.get('X-Touch-Grant');
 assert.ok(grant);assert.equal((await call('/touch','POST',auth,'{}')).status,403);
 assert.equal((await call('/touch','POST',{...auth,'X-Touch-Grant':grant},'{}')).status,204);assert.equal(input,1);
 const old=share.peer;left=0;
 assert.equal((await call('/frame','GET',auth)).status,402);assert.equal(stopped,1);
 assert.equal((await share.input(old,'touch',grant,{},true)).status,403);
 left=300;assert.equal((await call('/frame','GET',auth)).status,403);
});
