const {spawn}=require('node:child_process');
const readline=require('node:readline');
class Native {
  constructor(file,onExit){
    this.pending=new Map();this.id=0;
    this.process=spawn(file,[],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    readline.createInterface({input:this.process.stdout}).on('line',line=>{
      try{const r=JSON.parse(line);const call=this.pending.get(r.id);if(!call)return;
        this.pending.delete(r.id);r.error?call.reject(Error(r.error)):call.resolve(r.result);
      }catch{this.process.kill();}
    });
    this.process.on('error',()=>this.fail(onExit));this.process.on('exit',()=>this.fail(onExit));
    this.process.stdin.on('error',()=>this.fail(onExit));
  }
  fail(onExit){if(this.closed)return;this.closed=true;for(const call of this.pending.values())call.reject(Error('Windows display helper stopped.'));this.pending.clear();onExit();}
  call(op,values={}){
    if(this.closed||this.pending.size>64)return Promise.reject(Error('Windows display helper is unavailable or busy.'));
    const id=++this.id;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Windows did not respond.'));this.process.kill();},12000);
      this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});
      this.process.stdin.write(JSON.stringify({id,op,...values})+'\n');
    });
  }
}
module.exports={Native};
