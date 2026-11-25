const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('host',{action:(name,value)=>ipcRenderer.invoke('host-action',name,value),onState:fn=>ipcRenderer.on('state',(_,state)=>fn(state))});
