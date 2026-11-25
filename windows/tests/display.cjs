'use strict';
const { _electron,chromium }=require('playwright-core');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const executablePath=path.join(process.env.ProgramFiles,'MCODE','Phone as a Second Monitor','PhoneAsMonitor.exe');
  const host=await _electron.launch({executablePath,timeout:35000});
  let browser,control;
  try{
    const until=Date.now()+25000;
    do{control=host.windows().find(w=>w.url().endsWith('/host.html'));if(!control)await new Promise(r=>setTimeout(r,200));}while(!control&&Date.now()<until);
    assert.ok(control,'The installed tray app did not open its pairing screen.');
    await control.locator('#code').waitFor();
    const url=await control.locator('#url').innerText();
    const code=await control.locator('#code').innerText();
    assert.match(code,/^[0-9]{8}$/);
    browser=await chromium.launch({channel:'msedge',headless:true});
    const phone=await browser.newPage({viewport:{width:884,height:832},hasTouch:true,isMobile:true});
    const responses=[];
    phone.on('response',async response=>{
      const endpoint=new URL(response.url()).pathname;
      if(response.status()>=400 && ['/frame','/video-offer','/video-status'].includes(endpoint)){
        try{responses.push([endpoint,response.status(),(await response.text()).slice(0,300)]);}catch{}
      }
    });
    await control.evaluate(()=>{
      window.monitorMessages=[];
      new MutationObserver(()=>{const v=document.querySelector('#notice').textContent;if(v&&!window.monitorMessages.includes(v))window.monitorMessages.push(v);})
        .observe(document.querySelector('#notice'),{childList:true,subtree:true,characterData:true});
    });
    await phone.goto(url+'/#'+code);await phone.locator('#form button').click();
    await control.locator('#controls').check();await control.locator('#approve').click();
    try{
      await phone.waitForFunction(()=>document.querySelector('#picture').naturalWidth>0 || document.querySelector('#movie').videoWidth>0,{},{timeout:35000});
    }catch{
      const displays=await host.evaluate(({screen})=>screen.getAllDisplays().map(d=>({name:d.label,bounds:d.bounds,scale:d.scaleFactor})));
      throw Error('No frame. Phone: '+await phone.locator('#message').textContent()+'; host: '+JSON.stringify(await control.evaluate(()=>window.monitorMessages))+'; requests: '+JSON.stringify(responses)+'; Windows displays: '+JSON.stringify(displays));
    }
    await phone.waitForFunction(()=>document.querySelector('#movie').readyState>=2 && document.querySelector('#movie').currentTime>0.25,{},{timeout:25000});
    assert.equal(await control.locator('#heading').innerText(),'Your second monitor is ready');
    await phone.locator('#menu').click();
    await phone.locator('[data-action=start]').waitFor();
    assert.equal(await phone.locator('[data-action=dock]').isVisible(),false);
    assert.equal(await phone.locator('#demoClock').isVisible(),true);
    await control.locator('#live [data-op=disconnect]').click();
    await control.locator('#pair').waitFor();
    console.log('Windows app, local approval, extended-monitor WebRTC frames, Windows menu, trial clock and disconnect passed.');
  }finally{await browser?.close();await host.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
