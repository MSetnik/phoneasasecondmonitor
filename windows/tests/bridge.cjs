const {Native}=require('../app/bridge');
const host=new Native(process.argv[2],()=>{});
(async()=>{
  try{
    await host.call('health');
    const diagnostics=await host.call('diagnostics');
    require('node:assert/strict').match(diagnostics,/app paths: \d+/);
    console.log(diagnostics);
    const area=await host.call('check');
    console.log('Windows helper answered an application IPC request. Active separate display:',Boolean(area));
  }finally{host.process.stdin.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
