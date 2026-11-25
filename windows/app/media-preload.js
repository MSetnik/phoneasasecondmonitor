const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('capture',{
  listen:fn=>ipcRenderer.on('capture-command',(_,request)=>fn(request)),
  reply:(id,result,error)=>ipcRenderer.send('capture-reply',{id,result,error}),
  input:(id,message)=>ipcRenderer.invoke('capture-input',id,message)
});
