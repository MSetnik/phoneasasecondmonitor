'use strict';
const video=document.querySelector('video'),canvas=document.createElement('canvas');
let track,stream,pc,videoID,sender,frames,previousTime,fps,level;
function closePeer(){if(pc)pc.close();pc=null;sender=null;videoID=null;frames=previousTime=undefined;level=-1;}
function stop(){closePeer();if(track)track.stop();track=stream=null;video.srcObject=null;}
async function offer(id){
  closePeer();const peer=pc=new RTCPeerConnection({iceServers:[]});videoID=id;
  sender=peer.addTrack(track,stream);
  const data=peer.createDataChannel('keyboard',{ordered:true});
  let queued=0;
  data.onmessage=async e=>{
    if(peer!==pc||typeof e.data!=='string'||e.data.length>18000||++queued>40){data.close();return;}
    try{
      const msg=JSON.parse(e.data);
      const result=await capture.input(id,msg);
      if(data.readyState==='open')data.send(JSON.stringify({id:msg.id,...result}));
    }catch{}finally{queued--;}
  };
  await peer.setLocalDescription(await peer.createOffer());
  if(peer.iceGatheringState!=='complete')await new Promise(resolve=>{
    const end=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',change);resolve();};
    const change=()=>{if(peer.iceGatheringState==='complete')end();};
    const timer=setTimeout(end,2000);peer.addEventListener('icegatheringstatechange',change);change();
  });
  if(peer!==pc)throw Error('Connection ended.');
  return peer.localDescription.sdp;
}
const operations={
  async start({source,area}){
    stop();
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:source,
      minWidth:area.width,maxWidth:area.width,minHeight:area.height,maxHeight:area.height,maxFrameRate:area.fps}}});
    track=stream.getVideoTracks()[0];track.contentHint='detail';video.srcObject=stream;await video.play();fps=area.fps;return true;
  },
  stop,closePeer,offer:({id})=>offer(id),
  async answer({id,sdp}){if(id!==videoID||!pc)throw Error('Video session ended.');await pc.setRemoteDescription({type:'answer',sdp});},
  async stats({detail}){
    if(!sender||!pc)throw Error('Video session ended.');
    if(level!==detail){
      const params=sender.getParameters();
      if(params.encodings?.length){params.encodings[0].maxBitrate=[30000000,18000000,10000000][detail];params.encodings[0].scaleResolutionDownBy=[1,1.2,1.5][detail];
        try{await sender.setParameters(params);level=detail;}catch{}}
    }
    let sent=-1;
    for(const report of (await sender.getStats()).values()){
      if(report.type!=='outbound-rtp'||report.kind!=='video')continue;
      if(frames!==undefined && report.timestamp>previousTime)sent=Math.round((report.framesEncoded-frames)*1000/(report.timestamp-previousTime));
      frames=report.framesEncoded;previousTime=report.timestamp;
    }
    return {fps:sent,moving:sent>5};
  },
  async jpeg(){
    if(!track || !video.videoWidth)return null;
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext('2d',{alpha:false}).drawImage(video,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.83));
    return new Uint8Array(await blob.arrayBuffer());
  }
};
capture.listen(async ({id,op,args})=>{try{const result=await operations[op](args);capture.reply(id,result,null);}catch(e){capture.reply(id,null,e.message);}});
