'use strict';
const {app,BrowserWindow,Tray,Menu,screen,desktopCapturer,ipcMain,safeStorage,clipboard,shell,dialog,powerMonitor,powerSaveBlocker}=require('electron');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const QR=require('qrcode');
const {Sharing}=require('./server'),{Native}=require('./bridge'),{License}=require('./license');
const title='Phone as a Second Monitor';
let ui,worker,tray,server,native,license,settings,prefs,viewer,qr='',notice='',address='',blocker;
let lastPeer=null,expired=false,quitting=false,mediaID=0,chain=Promise.resolve(),opening=false,checkout,checkingTopology=false;
const calls=new Map();
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>show());
  app.whenReady().then(start).catch(e=>{dialog.showErrorBox(title,e.message);app.quit();});
}
function show(){if(ui){ui.show();ui.focus();}}
function save(){fs.writeFileSync(prefs+'.tmp',JSON.stringify(settings));fs.renameSync(prefs+'.tmp',prefs);}
function networks(){return [...new Set(Object.values(os.networkInterfaces()).flat().filter(n=>n && n.family==='IPv4' && !n.internal && !n.address.startsWith('169.254.')).map(n=>n.address))];}
function state(){const p=server?.peer;return {ready:!!address,ips:networks(),address,qr,code:server?.code,phase:p?.error?'failed':p?.delivered?'live':p?.approved?'preparing':p?'approval':'pairing',ip:p?.ip,
  displayLayout:!!p?.displayLayout,repairing:!!p?.repairing,touch:!!p?.grant,left:license?.remaining(),notice:p?.error||notice,port:settings?.port};}
function changed(){
  if(!ui||ui.isDestroyed())return;
  const peer=server?.peer;
  if(peer&&!lastPeer)show();lastPeer=peer;
  ui.webContents.send('state',state());
  const expected=address&&server?.code;
  if(expected && changed.key!==address+expected){changed.key=address+expected;
    const key=changed.key;QR.toDataURL('http://'+address+'/#'+expected,{margin:2,width:244}).then(img=>{if(key===changed.key){qr=img;ui?.webContents.send('state',state());}}).catch(()=>{});}
}
function media(op,args={}){
  return new Promise((resolve,reject)=>{
    const id=++mediaID;
    const timeout=setTimeout(()=>{calls.delete(id);reject(Error('The video engine did not respond.'));},10000);
    calls.set(id,{finish:(result,error)=>{clearTimeout(timeout);calls.delete(id);error?reject(Error(error)):resolve(result);}});
    worker.webContents.send('capture-command',{id,op,args});
  });
}
function enqueue(fn){chain=chain.catch(()=>{}).then(fn);return chain;}
function stopMedia(){
  return enqueue(async()=>{try{await media('stop');}finally{
    if(blocker!==undefined){powerSaveBlocker.stop(blocker);blocker=undefined;}
    await native.call('detach');
  }}).catch(e=>{notice=e.message;changed();});
}
function matchingDisplay(area){
  const point=screen.screenToDipPoint({x:area.x+Math.floor(area.width/2),y:area.y+Math.floor(area.height/2)});
  const display=screen.getDisplayNearestPoint(point);
  if(display.id===screen.getPrimaryDisplay().id)return null;
  const origin=screen.dipToScreenPoint({x:display.bounds.x,y:display.bounds.y});
  const size=display.size;
  return Math.abs(origin.x-area.x)<=2 && Math.abs(origin.y-area.y)<=2 &&
    Math.abs(size.width*display.scaleFactor-area.width)<=2 && Math.abs(size.height*display.scaleFactor-area.height)<=2 ? display:null;
}
async function startMedia(size,p){
  return enqueue(async()=>{
    if(server.peer!==p)throw Error('Pairing ended.');
    await media('stop');
    const area=await native.call('attach',size);
    let source;
    for(let i=0;i<14 && server.peer===p;i++){
      const display=matchingDisplay(area);
      if(display){source=(await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}})).find(s=>s.display_id===String(display.id));}
      if(source)break;
      await new Promise(r=>setTimeout(r,150));
    }
    if(!source || server.peer!==p)throw Error('Windows could not identify the separate monitor. Open Display settings and choose Extend.');
    await media('start',{source:source.id,area});
    if(blocker===undefined)blocker=powerSaveBlocker.start('prevent-display-sleep');
    return area;
  });
}
async function listen(rotate=false,ip=settings.ip){
  if(opening)return;opening=true;
  try{
    server?.close();address='';qr='';notice='';
    await native.call('health');
    const ips=networks();if(!ips.includes(ip))ip=ips[0];if(!ip)throw Error('Connect this PC to the same local network as your phone, then retry.');
    server=new Sharing({remaining:()=>license.remaining(),changed,startMedia,stopMedia,media,onFailure:message=>{notice=message;},sendInput:input=>native.call('input',input)});
    await server.listen(ip,rotate?0:settings.port||0,viewer);
    settings.ip=ip;settings.port=server.server.address().port;save();address=server.address;
  }catch(e){notice=e.code==='EADDRINUSE'?'The saved port is busy. Choose another port below.':e.message;}finally{opening=false;changed();}
}
function localWindow(file,preload,options){
  const win=new BrowserWindow({...options,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:path.join(__dirname,preload)}});
  win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  return win;
}
function trusted(event,win){return win && event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame;}
async function checkPurchase(recovery,buy=false){
  const link=await license.check(recovery);
  if(!link){notice='Lifetime access is active. Save your recovery code.';checkout?.close();changed();return;}
  if(buy){
    if(checkout){checkout.focus();return;}
    checkout=new BrowserWindow({parent:ui,width:530,height:810,title:'Secure checkout with Stripe',autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'pasm-checkout'}});
    checkout.webContents.setWindowOpenHandler(({url})=>{if(new URL(url).protocol==='https:')void shell.openExternal(url);return {action:'deny'};});
    checkout.on('closed',()=>{checkout=null;license.check().then(()=>changed()).catch(()=>{});});
    await checkout.loadURL(link);
  }
  notice=buy?'When payment is complete, return here to check your purchase.':'No completed payment yet.';changed();
}
async function start(){
  app.setAppUserModelId('hr.mcode.PhoneAsASecondMonitor');viewer=path.join(process.resourcesPath,'viewer');
  prefs=path.join(app.getPath('userData'),'settings.json');settings=fs.existsSync(prefs)?JSON.parse(fs.readFileSync(prefs)):{};license=new License(path.join(app.getPath('userData'),'access.bin'),safeStorage);
  native=new Native(path.join(process.resourcesPath,'MonitorHost.exe'),()=>{notice='The Windows display helper stopped. Restart the app.';server?.reset();changed();});
  worker=localWindow('media.html','media-preload.js',{show:false,skipTaskbar:true});
  ui=localWindow('host.html','preload.js',{title,width:530,height:760,minWidth:440,minHeight:540,show:false,icon:path.join(viewer,'display-icon.png')});
  ipcMain.on('capture-reply',(e,r)=>{if(trusted(e,worker))calls.get(r.id)?.finish(r.result,r.error);});
  ipcMain.handle('capture-input',async(e,id,msg)=>{
    const p=server?.peer;if(!trusted(e,worker)||!p||p.videoID!==id||msg.token!==p.token)return {status:403};
    try{return await server.input(p,msg.kind,msg.grant,JSON.parse(msg.body),true);}catch{return {status:409,responseText:'Input could not be completed.'};}
  });
  ipcMain.handle('host-action',async(e,op,value)=>{
    if(!trusted(e,ui))throw Error('Unknown window.');
    try{
      switch(op){
        case 'state':return state();
        case 'approve':await server.approve(value===true);break;
        case 'disconnect':server.reset();break;
        case 'touch':if(server.peer?.ready){server.peer.grant=value===true?crypto.randomUUID():null;await native.call('release');}break;
        case 'network':if(networks().includes(value))await listen(false,value);break;
        case 'rotate':await listen(true);break;
        case 'retry':await listen();break;
        case 'buy':await checkPurchase(undefined,true);break;
        case 'check':await checkPurchase();break;
        case 'restore':await checkPurchase(String(value));break;
        case 'copy':if(license.remaining()===null){clipboard.writeText(license.data.code);notice='Recovery code copied.';}break;
        case 'diagnostics':{
          const details=await native.call('diagnostics');
          clipboard.writeText('Phone as a Second Monitor '+app.getVersion()+' | OS '+os.release()+' | '+details);
          dialog.showMessageBox(ui,{type:'info',message:'Display diagnostics copied',detail:details,buttons:['OK']}).catch(()=>{});
          break;
        }
        case 'repair':{
          const peer=server?.peer;
          if(!peer?.error || peer.repairing || peer.displayLayout)break;
          peer.repairing=true;changed();
          try{
            const reboot=await native.call('repair');
            if(server.peer===peer){
              server.reset();
              notice=reboot?'Restart Windows to finish repairing the driver, then pair again.':'The virtual display adapter restarted. Scan the new QR code to reconnect.';
            }
          }catch(error){
            if(server.peer===peer){peer.error='Driver repair did not finish. '+error.message;}
          }finally{peer.repairing=false;}
          break;
        }
        case 'display':await shell.openExternal('ms-settings:display');break;
        default:throw Error('Unknown action.');
      }
    }catch(e){notice=e.message;}changed();return state();
  });
  await Promise.all([worker.loadFile(path.join(__dirname,'media.html')),ui.loadFile(path.join(__dirname,'host.html'))]);
  ui.on('close',e=>{if(!quitting){e.preventDefault();ui.hide();}});
  tray=new Tray(path.join(viewer,'display-icon.png'));tray.setToolTip(title);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Phone as a Second Monitor',click:show},{label:'Disconnect device',click:()=>server?.reset()},{type:'separator'},{label:'Quit',click:()=>app.quit()}]));
  tray.on('click',show);
  powerMonitor.on('lock-screen',()=>server?.reset());powerMonitor.on('suspend',()=>server?.reset());
  await listen();show();
  license.check().then(changed).catch(()=>{});
  let ticks=0;
  setInterval(async()=>{
    server?.tick();const end=license.remaining()===0;if(end&&!expired)show();expired=end;changed();ticks++;
    if(ticks%5===0 && !license.checking && checkout)license.check().then(()=>{if(license.remaining()===null){notice='Lifetime access is active.';checkout?.close();changed();}}).catch(()=>{});
    if(ticks%21600===0 && !license.checking)license.check().then(changed).catch(()=>{});
    const p=server?.peer;
    if(p?.ready && !checkingTopology){checkingTopology=true;try{
      const a=await native.call('check');
      if(server.peer===p&&p.ready&&(!a||!matchingDisplay(a)||a.name!==p.area.name||a.x!==p.area.x||a.y!==p.area.y||a.width!==p.area.width||a.height!==p.area.height)){server.reset();notice='Your Windows display arrangement changed. Pair again.';}
    }catch{server?.reset();}finally{checkingTopology=false;}}
  },1000).unref();
}
app.on('before-quit',()=>{quitting=true;server?.close();native?.process.stdin.end();});
