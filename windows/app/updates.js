'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const path=require('node:path');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

const feed='https://phoneasasecondmonitor.app/updates/windows.json';
const bucket='https://storage.googleapis.com/phone-as-monitor-mcode-downloads/windows/x64/';
const filename='Phone-as-a-Second-Monitor-Windows-x64-Setup.exe';
const publicKey=crypto.createPublicKey({format:'der',type:'spki',key:Buffer.concat([
  Buffer.from('302a300506032b6570032100','hex'),Buffer.from('2h45R7xIOnAQNSgI+1fuOJz+rKgq6q8/KCvQ0vAtQ5k=','base64')
])});

function versionParts(value){
  if(typeof value!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value))throw Error('Invalid release version.');
  return value.split('.').map(Number);
}
function isNewer(candidate,installed){
  const current=versionParts(installed), next=versionParts(candidate);
  for(let i=0;i<3;i++)if(next[i]!==current[i])return next[i]>current[i];
  return false;
}
function verifiedRelease(envelope,key=publicKey){
  const bytes=Buffer.from(envelope.payload,'base64');
  if(!crypto.verify(null,bytes,key,Buffer.from(envelope.signature,'base64')))throw Error('Update signature is invalid.');
  const r=JSON.parse(bytes);
  versionParts(r.version);
  if(r.platform!=='windows-x64'||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||
     !Number.isSafeInteger(r.size)||r.size<=0||r.size>512*1024*1024||typeof r.notes!=='string'||!r.notes.trim()||r.notes.length>1500)throw Error('Invalid release details.');
  return r;
}
async function latestRelease(){
  const response=await fetch(feed,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Update service unavailable.');
  const chunks=[];let size=0;
  for await(const chunk of response.body){
    size+=chunk.length;if(size>16384)throw Error('Invalid update feed.');
    chunks.push(chunk);
  }
  return verifiedRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
async function downloadInstaller(release,cache,onProgress,fetchFile=fetch){
  await fs.mkdir(cache,{recursive:true});
  const directory=await fs.mkdtemp(path.join(cache,'release-'));
  const file=path.join(directory,filename);
  try{
    const response=await fetchFile(bucket+release.sha256+'/'+filename,{redirect:'error',signal:AbortSignal.timeout(15*60*1000)});
    if(!response.ok||!response.body)throw Error('Could not download the update.');
    const hash=crypto.createHash('sha256');let size=0,last=-1;
    const verify=new Transform({transform(chunk,_,done){
      size+=chunk.length;
      if(size>release.size)return done(Error('Unexpected installer size.'));
      hash.update(chunk);
      const percent=Math.floor(100*size/release.size);
      if(percent!==last){last=percent;onProgress(percent);}
      done(null,chunk);
    }});
    const handle=await fs.open(file,'wx');
    await pipeline(Readable.fromWeb(response.body),verify,handle.createWriteStream());
    if(size!==release.size||hash.digest('hex')!==release.sha256)throw Error('The installer did not pass verification.');
    if(process.platform==='win32'){
      await fs.writeFile(file+':Zone.Identifier','[ZoneTransfer]\r\nZoneId=3\r\nHostUrl='+bucket+release.sha256+'/'+filename+'\r\n');
    }
    return file;
  }catch(error){await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});throw error;}
}

class Updates{
  constructor({installed,cache,preferences,save,busy,change,show,launch,quit}){
    Object.assign(this,{installed,cache,preferences,save,busy,change,show,launch,quit});
    this.state={phase:'idle'};this.promptPending=false;
  }
  set(phase,message='',percent=0){
    this.state={phase,message,percent,version:this.release?.version,notes:this.release?.notes};this.change();
  }
  async check(manual=false){
    if(manual)this.show();
    if(['downloading','launching','ready'].includes(this.state.phase))return;
    if(this.checking){
      if(manual){this.reportCheck=true;this.set('checking','Checking for updates…');}
      return;
    }
    this.checking=true;
    this.reportCheck=manual;
    if(manual)this.set('checking','Checking for updates…');
    try{
      const release=await latestRelease();
      if(!isNewer(release.version,this.installed)){
        this.release=null;this.promptPending=false;this.set(this.reportCheck?'current':'idle','You have the latest version.');return;
      }
      const previous=this.release?.version;
      if(this.release?.sha256!==release.sha256)this.file=null;
      this.release=release;
      const snooze=this.preferences.updateReminder;
      if(!this.reportCheck&&snooze?.version===release.version&&Date.now()<snooze.until){this.set('idle');return;}
      if(!this.reportCheck&&(previous!==release.version||this.state.phase==='idle'))this.promptPending=true;
      this.set('available');this.presentIfIdle();
    }catch{if(this.reportCheck)this.set('error','Could not check for updates. Check your connection and try again.');}
    finally{this.checking=false;}
  }
  presentIfIdle(){
    if(this.promptPending&&!this.busy()){this.promptPending=false;this.show();}
  }
  later(){
    if(this.release && ['available','ready','error'].includes(this.state.phase)){
      this.preferences.updateReminder={version:this.release.version,until:Date.now()+86400000};this.save();
    }
    if(!['checking','downloading','launching'].includes(this.state.phase)){this.promptPending=false;this.set('idle');}
  }
  async install(){
    if(this.checking||!this.release||this.busy()||!['available','ready','error'].includes(this.state.phase))return;
    try{
      if(!this.file){
        this.set('downloading','Downloading the update…');
        this.file=await downloadInstaller(this.release,this.cache,percent=>this.set('downloading','Downloading the update…',percent));
      }
      else{
        this.set('downloading','Verifying the downloaded update…',100);
        const hash=crypto.createHash('sha256');
        for await(const chunk of createReadStream(this.file))hash.update(chunk);
        if(hash.digest('hex')!==this.release.sha256){this.file=null;throw Error('Invalid installer.');}
      }
      if(this.busy()){this.promptPending=true;this.set('ready','Your update is ready. Disconnect the display to install it.');return;}
      this.set('launching','Opening Windows Setup…');
      const error=await this.launch(this.file);
      if(error)throw Error('Setup did not open.');
      this.quit();
    }catch{if(this.state.phase==='downloading')this.file=null;this.set('error',this.file?'Setup did not open. Select Update to try again.':'Could not download or verify the update. Select Update to retry.');}
  }
}
module.exports={Updates,isNewer,verifiedRelease,downloadInstaller};
