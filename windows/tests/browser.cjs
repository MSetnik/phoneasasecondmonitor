'use strict';
// Runs the production sender, viewer and LAN routes with a changing test image.
const {chromium}=require('playwright-core');
const {Sharing}=require('../app/server');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const browser=await chromium.launch({executablePath:process.env.PASM_CHROME,channel:process.env.PASM_CHROME?undefined:'msedge',headless:true});
  let host;
  try{
    const sender=await browser.newPage();let id=0;const calls=new Map(),events=[];
    await sender.exposeFunction('mediaReply',(id,value,error)=>{const call=calls.get(id);if(!call)return;calls.delete(id);error?call.reject(Error(error)):call.resolve(value);});
    await sender.exposeFunction('dataInput',async(videoID,msg)=>{
      assert.equal(videoID,host.peer.videoID);assert.equal(msg.token,host.peer.token);
      return host.input(host.peer,msg.kind,msg.grant,JSON.parse(msg.body),true);
    });
    const media=(op,args={})=>new Promise((resolve,reject)=>{
      const current=++id;calls.set(current,{resolve,reject});
      sender.evaluate(r=>window.sendToCapture(r),{id:current,op,args}).catch(reject);
    });
    host=new Sharing({remaining:()=>1160,changed(){},media,stopMedia(){void media('stop').catch(()=>{});},
      async startMedia(size){await media('start',{source:'test',area:size});return size;},
      async sendInput(input){events.push(input);return {status:204,responseText:''};}});
    await host.listen('127.0.0.1',0,path.resolve(__dirname,'../../viewer'));
    const url='http://'+host.address;
    await sender.route(url+'/test-sender',r=>r.fulfill({contentType:'text/html',body:'<video muted autoplay></video>'}));
    await sender.goto(url+'/test-sender');
    await sender.evaluate(()=>{
      window.capture={listen:fn=>window.sendToCapture=fn,reply:(id,v,e)=>window.mediaReply(id,v instanceof Uint8Array?Array.from(v):v,e),input:window.dataInput};
      const image=document.createElement('canvas');image.width=800;image.height=600;
      const ctx=image.getContext('2d');let counter=0;
      function draw(){ctx.fillStyle=counter++%2?'#183aca':'#fe8b38';ctx.fillRect(0,0,800,600);}
      draw();setInterval(draw,40);navigator.mediaDevices.getUserMedia=async()=>image.captureStream(25);
    });
    await sender.addScriptTag({path:path.resolve(__dirname,'../app/media.js')});
    const phone=await browser.newPage({viewport:{width:800,height:600},isMobile:true,hasTouch:true});
    await phone.goto(url+'/#'+host.code);
    const pairing=phone.waitForResponse(r=>r.url().endsWith('/pair'));
    await phone.locator('#form button').click();await pairing;await host.approve(true);
    await phone.waitForFunction(()=>document.querySelector('#movie').currentTime>0.3,null,{timeout:25000});
    await phone.locator('#menu').click();
    assert.equal(await phone.locator('[data-action=start]').isVisible(),true);
    assert.equal(await phone.locator('[data-action=missionControl]').isVisible(),false);
    await phone.locator('[data-action=taskView]').click();
    for(let i=0;i<30&&!events.length;i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(events.at(-1)?.body.action,'taskView');assert.equal(events.at(-1)?.encrypted,true);
    console.log('Browser received and decoded WebRTC frames and sent an authenticated Windows action over the data channel.');
  }finally{host?.close();await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
