'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const actions = ['point','keyboard','keyboardShortcuts','rightClick','start','taskView'];
const files = {'/':['viewer.html','text/html; charset=utf-8'], '/menu.js':['menu.js','text/javascript'],
  '/video.js':['video.js','text/javascript'], '/controls.js':['controls.js','text/javascript'],
  '/awake.mp4':['awake.mp4','video/mp4'],'/display-icon.png':['display-icon.png','image/png'],
  '/display.webmanifest':['display.webmanifest','application/manifest+json']};
function layout(raw, refresh) {
  const match = /^(\d{1,5})x(\d{1,5})@([0-9.]{1,10})$/.exec(raw || '');
  let w=match?Number(match[1]):1280, h=match?Number(match[2]):720;
  let scale=match?Number(match[3]):1;
  if (!w || !h || !Number.isFinite(scale) || scale<=0) {w=1280;h=720;scale=1;}
  scale=Math.min(scale,2560/Math.max(w,h));
  return {width:Math.max(320,Math.round(w*scale/2)*2),height:Math.max(320,Math.round(h*scale/2)*2),fps:refresh>=105?120:refresh>=75?90:60};
}
async function read(req,limit=65536) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Request too large.');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
class Sharing {
  constructor(deps) {Object.assign(this,deps);this.failures=[];this.code='';this.peer=null;this.reset();}
  reset() {
    const old=this.peer;this.peer=null;
    this.code=String(crypto.randomInt(100000000)).padStart(8,'0');
    if(old && old.approved)this.stopMedia();
    this.changed?.();
  }
  tick(){
    this.failures=this.failures.filter(t=>Date.now()-t<60000);
    if(this.peer && (this.remaining()===0 || (!this.peer.repairing && Date.now()-this.peer.seen>30000) || (!this.peer.approved && Date.now()-this.peer.created>90000)))this.reset();
  }
  async approve(touch){
    const p=this.peer;if(!p||p.approved||this.remaining()===0)return;
    this.setTouch(p,touch);p.approved=true;
    await this.resize(p,p.size);
  }
  setTouch(p,enabled){
    if(!p || p!==this.peer)return;
    if(!enabled)p.grant=null;
    if(p.viewerID)this.rememberTouch(p.viewerID,enabled);
    p.grant=enabled?crypto.randomUUID():null;
  }
  async resize(p,size){
    if(p.busy||this.peer!==p)return;
    p.size=size;p.busy=true;p.ready=false;p.delivered=false;p.offer=null;p.videoID=null;p.frame=null;
    try {const area=await this.startMedia(size,p);if(this.peer===p){p.area=area;p.ready=true;}}
    catch(e){if(this.peer===p){p.error=e.message;p.displayLayout=e.displayLayout===true;this.onFailure?.(e.message);this.stopMedia();}}
    finally{p.busy=false;this.changed();}
  }
  async input(p,kind,grant,body,encrypted){
    if(!p || p!==this.peer || !p.ready || !p.grant || grant!==p.grant || this.remaining()===0)return {status:403,responseText:'Touch control is off.'};
    if(!['touch','keyboard'].includes(kind)||!body||typeof body!=='object')return {status:400,responseText:'Invalid input.'};
    return this.sendInput({kind,body,encrypted});
  }
  async listen(ip,port,root){
    this.ip=ip;this.assets=new Map(Object.entries(files).map(([route,[name,type]])=>[route,[fs.readFileSync(path.join(root,name)),type]]));
    this.server=http.createServer({requestTimeout:10000,headersTimeout:8000,maxHeaderSize:8192},(req,res)=>{
      this.handle(req,res).catch(()=>{if(!res.headersSent){res.writeHead(400);res.end('Request failed.');}else res.destroy();});
    });
    this.server.maxConnections=32;
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,ip,resolve);});
    this.address=ip+':'+this.server.address().port;
  }
  close(){this.reset();this.server?.closeAllConnections();this.server?.close();}
  async handle(req,res){
    const h=req.headers,route=req.url,method=req.method;
    const reply=(status,body='',type='text/plain; charset=utf-8',extra={})=>{
      const left=this.remaining();
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...(left===null?{}:{'X-Demo-Remaining':String(left)}),...extra});
      res.end(body);
    };
    if(h.host!==this.address || (h.origin && h.origin!=='http://'+this.address))return reply(403);
    if(method==='GET'&&this.assets.has(route)){const [data,type]=this.assets.get(route);return reply(200,data,type);}
    this.tick();
    if(this.remaining()===0)return reply(402,'Your free demo has ended. Open the Windows app to continue.');
    const ip=req.socket.remoteAddress;
    if(method==='POST'&&route==='/pair'){
      if(this.peer)return reply(409,'A device is already pairing or connected.');
      if(this.failures.length>=8)return reply(429,'Too many attempts. Try again in one minute.');
      if(h['x-pair-code']!==this.code){this.failures.push(Date.now());return reply(403,'Check the code on your PC.');}
      const now=Date.now();
      const key=h['x-viewer-key'];
      const viewerID=typeof key==='string' && /^[0-9a-f]{64}$/.test(key)?crypto.createHash('sha256').update(key).digest('hex'):null;
      this.peer={viewerID,requestID:crypto.randomUUID(),preferredTouch:!!viewerID && this.touchAllowed(viewerID),ip,token:crypto.randomUUID(),size:layout(h['x-viewport'],Number(h['x-refresh-hz'])),seen:now,created:now,approved:false,seq:0};
      this.changed();return reply(200,this.peer.token);
    }
    const p=this.peer;
    if(!p || ip!==p.ip || h.authorization!=='Bearer '+p.token)return reply(403,'Connection ended. Scan a new code.');
    p.seen=Date.now();
    if(method==='POST'&&route==='/leave'){this.reset();return reply(204);}
    if(method==='GET'&&route==='/capabilities')return reply(200,JSON.stringify({platform:'windows',actions}),'application/json');
    if(p.error)return reply(503,p.error);
    if(method==='GET'&&route==='/frame'&&!p.ready)return reply(202,p.approved?'Windows is preparing your second monitor…':'Approve the connection on your PC.');
    if(!p.ready)return reply(403);
    const grant=p.grant?{'X-Touch-Grant':p.grant}:{};
    if(method==='POST'&&(route==='/touch'||route==='/keyboard')){
      const answer=await this.input(p,route.slice(1),h['x-touch-grant'],JSON.parse(await read(req,16384)),false);
      return reply(answer.status,answer.responseText);
    }
    if((route==='/frame'||route==='/video-status') && h['x-viewport']){
      const size=layout(h['x-viewport'],p.size.fps);
      if(size.width!==p.size.width || size.height!==p.size.height){void this.resize(p,size);return reply(route==='/frame'?202:409,'Resizing your monitor…');}
    }
    if(method==='GET'&&route==='/frame'){
      const drawn=Number(h['x-drawn']);
      if(!p.delivered && Number.isInteger(drawn) && drawn>0 && drawn<=p.seq){p.delivered=true;this.changed();}
      if(!p.frame && !p.pendingFrame){
        p.pendingFrame=this.media('jpeg').then(bytes=>{if(p===this.peer && bytes?.length){p.frame=Buffer.from(bytes);p.seq++;}}).finally(()=>{p.pendingFrame=null;});
      }
      if(p.pendingFrame)await p.pendingFrame;
      if(p!==this.peer||!p.ready||this.remaining()===0)return reply(403);
      if(!p.frame)return reply(202,'Waiting for the first frame…');
      const frame=p.frame;p.frame=null;return reply(200,frame,'image/jpeg',{'X-Frame':String(p.seq),...grant});
    }
    if(method==='POST'&&route==='/video-offer'){
      const id=crypto.randomUUID();p.videoID=id;p.offer=null;
      this.media('offer',{id}).then(sdp=>{if(p.videoID===id)p.offer=sdp;}).catch(()=>{if(p.videoID===id)p.offer=false;});
      return reply(200,JSON.stringify({id,...p.area}),'application/json');
    }
    if(!p.videoID||h['x-video-id']!==p.videoID)return reply(409);
    if(method==='GET'&&route==='/video-offer')return p.offer===false?reply(503):p.offer?reply(200,p.offer):reply(202);
    if(method==='POST'&&route==='/video-answer'){const sdp=await read(req);if(!sdp.startsWith('v=0')||p!==this.peer)return reply(400);await this.media('answer',{id:p.videoID,sdp});return reply(204);}
    if(method==='POST'&&route==='/video-stop'){p.videoID=null;await this.media('closePeer');return reply(204);}
    if(method==='GET'&&route==='/video-status'){
      if(!p.delivered && h['x-video-playing']==='1'){p.delivered=true;this.changed();}
      const stats=await this.media('stats',{detail:Math.max(0,Math.min(2,Number(h['x-video-detail'])||0))});
      if(p!==this.peer||this.remaining()===0)return reply(403);
      return reply(200,[p.area.fps,stats.fps,stats.moving?1:0].join(','),'text/plain',grant);
    }
    reply(404);
  }
}
module.exports={Sharing,layout};
