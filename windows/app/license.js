'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
class License {
  constructor(file,storage){this.file=file;this.storage=storage;
    if(!storage.isEncryptionAvailable())throw Error('Windows could not open your protected license storage.');
    if(fs.existsSync(file))this.data=JSON.parse(storage.decryptString(fs.readFileSync(file)));
    else {this.data={first:Date.now(),code:crypto.randomBytes(32).toString('hex'),until:0};this.save();}
    if(!Number.isFinite(this.data.first)||!Number.isFinite(this.data.until)||!/^[a-f0-9]{64}$/.test(this.data.code))throw Error('The saved license is damaged. Contact support to recover your purchase.');
    this.deadline=performance.now()+Math.min(1200000,Math.max(0,this.data.first+1200000-Date.now()));
  }
  save(){fs.writeFileSync(this.file+'.tmp',this.storage.encryptString(JSON.stringify(this.data)));fs.renameSync(this.file+'.tmp',this.file);}
  remaining(){const now=Date.now();if(this.data.until>now && now>=this.data.first)return null;
    return Math.max(0,Math.ceil(Math.min(this.deadline-performance.now(),this.data.first+1200000-now)/1000));}
  async check(recovery){
    if(this.checking)throw Error('A purchase check is already running.');
    this.checking=true;
    try{
      const code=recovery===undefined?this.data.code:String(recovery).trim().toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(code))throw Error('Enter your 64-character recovery code.');
      const response=await fetch('https://phone-as-monitor-mcode.web.app/api/license',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({license:code}),signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('The purchase service is unavailable. Try again.');
      const result=await response.json();
      if(typeof result.active!=='boolean')throw Error('Invalid license response.');
      if(recovery!==undefined&&!result.active)throw Error('No active purchase was found for that code.');
      let checkout;
      if(!result.active){
        checkout=new URL(result.checkout);
        const reference=crypto.createHash('sha256').update(code).digest('hex');
        if(checkout.origin!=='https://buy.stripe.com'||checkout.pathname.startsWith('/test_')||checkout.searchParams.get('client_reference_id')!==reference)throw Error('Checkout is unavailable.');
      }
      this.data.code=code;this.data.until=result.active?Date.now()+7*86400000:0;this.save();
      return checkout?.href;
    }finally{this.checking=false;}
  }
}
module.exports={License};
