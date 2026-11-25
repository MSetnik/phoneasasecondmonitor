'use strict';
const { _electron,chromium }=require('playwright-core');
const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
async function checkTouchScroll(host,control,phone){
  await host.evaluate(async({BrowserWindow,screen})=>{
    const display=screen.getAllDisplays().find(d=>d.id!==screen.getPrimaryDisplay().id);
    if(!display)throw Error('The scroll test needs the extended desktop.');
    const win=new BrowserWindow({...display.bounds,frame:false,show:false,webPreferences:{sandbox:true}});
    global.scrollTestWindow=win;
    await win.loadURL('data:text/html,<meta charset=utf-8><body style="margin:0;height:12000px">Scroll target');
    win.show();win.focus();
  });
  try{
    await phone.locator('#surface.interactive').waitFor();
    const rect=await phone.locator('#surface').boundingBox();
    const x=rect.x+rect.width*.4,y=rect.y+rect.height*.55;
    const session=await phone.context().newCDPSession(phone);
    const speed=control.locator('#scrollSpeed');
    assert.equal(await speed.inputValue(),'48','Balanced is the initial speed.');
    const distances=[];
    for(const value of ['96','48','24']){
      await speed.selectOption(value);
      await control.waitForFunction(async value=>(await window.host.action('state')).scrollSpeed===Number(value),value);
      const userData=await host.evaluate(({app})=>app.getPath('userData'));
      const saved=JSON.parse(fs.readFileSync(path.join(userData,'settings.json'),'utf8'));
      assert.equal(saved.scrollSpeed,Number(value),'The speed is saved for the next launch.');
      await host.evaluate(()=>{
        global.scrollTestWindow.focus();
        return global.scrollTestWindow.webContents.executeJavaScript('window.scrollTo(0,0)');
      });
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=24;i++){
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*3}]});
      }
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      let scroll=0, settled=0;
      for(let i=0;i<35 && settled<3;i++){
        await new Promise(r=>setTimeout(r,100));
        const position=await host.evaluate(()=>global.scrollTestWindow.webContents.executeJavaScript('window.scrollY'));
        settled=position>0 && position===scroll?settled+1:0;
        scroll=position;
      }
      distances.push(scroll);
    }
    await session.detach();
    console.log('72 CSS pixel swipe, Gentle / Balanced / Fast in Windows page pixels: '+distances.join(' / '));
    assert.ok(distances[0]>0 && distances[0]<distances[1] && distances[1]<distances[2],
      'Expected progressively longer scrolling at each speed, got '+distances.join(', '));
  }finally{
    await host.evaluate(()=>{global.scrollTestWindow.destroy();delete global.scrollTestWindow;});
  }
}
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
    await control.locator('#approval').waitFor();
    assert.equal(await control.locator('#controls').isChecked(),false);
    await control.locator('#controls').check();await control.locator('#approve').click();
    try{
      await phone.waitForFunction(()=>document.querySelector('#picture').naturalWidth>0 || document.querySelector('#movie').videoWidth>0,{},{timeout:35000});
    }catch{
      const displays=await host.evaluate(({screen})=>screen.getAllDisplays().map(d=>({name:d.label,bounds:d.bounds,scale:d.scaleFactor})));
      throw Error('No frame. Phone: '+await phone.locator('#message').textContent()+'; host: '+JSON.stringify(await control.evaluate(()=>window.monitorMessages))+'; requests: '+JSON.stringify(responses)+'; Windows displays: '+JSON.stringify(displays));
    }
    await phone.waitForFunction(()=>document.querySelector('#movie').readyState>=2 && document.querySelector('#movie').currentTime>0.25,{},{timeout:25000});
    assert.equal(await control.locator('#heading').innerText(),'Your second monitor is ready');
    await checkTouchScroll(host,control,phone);
    await phone.locator('#menu').click();
    await phone.locator('[data-action=start]').waitFor();
    assert.equal(await phone.locator('[data-action=dock]').isVisible(),false);
    assert.equal(await phone.locator('#demoClock').isVisible(),true);
    await control.locator('#live [data-op=disconnect]').click();
    await control.locator('#pair').waitFor();
    async function requestPair(page){
      const fresh=await control.locator('#code').innerText();
      await page.goto('about:blank');
      await page.goto(url+'/#'+fresh);
      await page.locator('#form button').click();
      await control.locator('#approval').waitFor();
    }
    async function decline(){
      await control.locator('#approval [data-op=disconnect]').click();
      await control.locator('#pair').waitFor();
    }
    await requestPair(phone);
    assert.equal(await control.locator('#controls').isChecked(),true,'Same browser should remember touch.');
    await control.locator('#controls').uncheck();
    await decline();
    const other=await browser.newPage();
    await requestPair(other);
    assert.equal(await control.locator('#controls').isChecked(),false,'New browser should start view-only.');
    await decline();
    await requestPair(phone);
    assert.equal(await control.locator('#controls').isChecked(),true,'A declined request must preserve the preference.');
    console.log('Remembered touch for the returning browser and isolated the new browser.');
    console.log('Windows app, local approval, extended-monitor WebRTC frames, Windows menu, trial clock and disconnect passed.');
  }finally{await browser?.close();await host.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
