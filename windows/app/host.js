'use strict';
const el=id=>document.getElementById(id);
function render(s){
 const phase=s.left===0?'expired':!s.ready?'offline':s.phase;
 const copy={
 pairing:['Step 1 of 3','Connect your phone','Join the same Wi-Fi network, then scan the QR code with your phone camera.'],
 approval:['Step 2 of 3','Approve this device','A device at '+s.ip+' wants to use the second display.'],
 preparing:['Step 3 of 3','Preparing the monitor','Windows is extending your desktop. Waiting for the first frame on your phone.'],
 live:['Connected','Your second monitor is ready','Drag a window onto the new display. Use the chevron on your phone for the keyboard and shortcuts.'],
 failed:['Connection interrupted','The monitor could not start','Repair restarts the app’s virtual display adapter. Windows may ask for administrator approval.'],
 offline:['Connection setup','Connect to your local network','Use the connection settings below to retry or choose another port.'],
 expired:['Lifetime access','Your free demo has ended','Unlock once to keep using your phone as a second monitor, or restore an earlier purchase.']};
 const [step,title,description]=copy[phase];el('step').textContent=step;el('heading').textContent=title;el('description').textContent=description;
 el('pair').hidden=phase!=='pairing';el('approval').hidden=phase!=='approval';el('live').hidden=phase!=='live';el('error').hidden=phase!=='failed';el('touch').checked=s.touch;
 if(s.qr&&el('qr').getAttribute('src')!==s.qr)el('qr').src=s.qr;
 el('url').textContent='http://'+s.address;el('code').textContent=s.code||'';el('notice').textContent=s.repairing?'Waiting for Windows to restart the virtual display adapter…':s.notice||'';
 document.querySelector('[data-op="repair"]').disabled=s.repairing;
 document.querySelector('#error [data-op="disconnect"]').disabled=s.repairing;
 el('clock').textContent=s.left===null?'Lifetime access':'Demo '+Math.floor(s.left/60)+':'+String(s.left%60).padStart(2,'0');
 if(phase==='expired')el('purchase').open=true;el('buy').hidden=s.left===null;el('copy').hidden=s.left!==null;
 const ips=s.ips.join('|');if(el('network').dataset.ips!==ips){el('network').replaceChildren(...s.ips.map(ip=>new Option(ip,ip)));el('network').dataset.ips=ips;}
 if(s.address)el('network').value=s.address.split(':')[0];
}
async function run(name,value){try{render(await host.action(name,value));}catch{el('notice').textContent='The app could not complete this action. Reopen it and try again.';}}
document.querySelectorAll('[data-op]').forEach(b=>b.onclick=()=>run(b.dataset.op));
el('approve').onclick=()=>run('approve',el('controls').checked);el('touch').onchange=()=>run('touch',el('touch').checked);
el('network').onchange=()=>run('network',el('network').value);
el('restore').onsubmit=e=>{e.preventDefault();const key=el('key').value;el('key').value='';run('restore',key);};
host.onState(render);run('state');
