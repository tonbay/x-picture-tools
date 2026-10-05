import {GIFEncoder, quantize, applyPalette} from './vendor/gifenc.mjs';
function event(target, name, run, timeout=20000) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);target.removeEventListener(name,done);target.removeEventListener('error',fail)};
    const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(Error('MP4 解碼失敗，請改下載 MP4 原檔'))};
    const timer=setTimeout(()=>{cleanup();reject(Error('媒體解碼逾時，請改下載 MP4 原檔'))},timeout);
    target.addEventListener(name,done,{once:true});target.addEventListener('error',fail,{once:true});
    try { run(); } catch(error) {cleanup();reject(error)}
  });
}
async function convert(message) {
  const asset=XPT.asset({type:'animated_gif',url:message.url}),prefs=XPT.preferences(message);
  const progress=(percent)=>chrome.runtime.sendMessage({type:'conversion-progress',jobId:message.jobId,percent}).catch(()=>{});
  const response=await fetch(asset.url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok||!/^video\/mp4(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('GIF 原檔下載失敗或格式無效');
  const blob=await response.blob();if(blob.size>100*1024*1024)throw Error('原檔超過 100 MB，請改下載 MP4');
  const video=document.createElement('video');video.muted=true;video.preload='auto';
  const url=URL.createObjectURL(blob);
  try {
    await event(video,'loadeddata',()=>video.src=url);
    const duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0||duration>120)throw Error('GIF 轉檔支援 120 秒以內的媒體，請改下載 MP4');
    const scale=prefs.gifWidth?Math.min(1,prefs.gifWidth/video.videoWidth):1;
    const width=Math.max(1,Math.round(video.videoWidth*scale)),height=Math.max(1,Math.round(video.videoHeight*scale));
    const frames=Math.ceil(duration*prefs.gifFps);
    if(width*height*frames>500000000)throw Error('轉檔量過大，請降低尺寸或幀率，或改下載 MP4');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true}),gif=GIFEncoder();
    for(let i=0;i<frames;i++){
      const time=Math.min(i/prefs.gifFps,duration-0.001);
      if(Math.abs(video.currentTime-time)>0.0001)await event(video,'seeked',()=>video.currentTime=time);
      ctx.drawImage(video,0,0,width,height);
      const rgba=ctx.getImageData(0,0,width,height).data,palette=quantize(rgba,256),indexed=applyPalette(rgba,palette);
      // Round cumulative frame times to GIF's 10 ms timebase to avoid speed drift.
      const delay=Math.max(10,(Math.round(Math.min((i+1)/prefs.gifFps,duration)*100)-Math.round(i*100/prefs.gifFps))*10);
      gif.writeFrame(indexed,width,height,{palette,delay,repeat:0});
      if(gif.bytesView().length>150*1024*1024)throw Error('GIF 輸出超過 150 MB，請降低尺寸或幀率');
      if(i%3===0){await progress(Math.round((i+1)/frames*100));await new Promise(r=>setTimeout(r,0))}
    }
    gif.finish();await XPTDirectories.set('blob:'+message.jobId,new Blob([gif.bytes()],{type:'image/gif'}));
    return {ok:true};
  } finally {video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
}
const urls=new Map();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('background.js')&&sender.url!==undefined)return;
  if(message?.type==='gif-blob-release'){if(urls.has(message.jobId))URL.revokeObjectURL(urls.get(message.jobId));urls.delete(message.jobId);respond({ok:true});return}
  if(message?.type==='gif-blob-url'){XPTDirectories.get('blob:'+message.jobId).then(blob=>{if(!blob)throw Error('轉檔結果遺失');const url=URL.createObjectURL(blob);urls.set(message.jobId,url);respond({url})}).catch(error=>respond({error:error.message}));return true}
  if(message?.type!=='convert-gif')return;
  convert(message).then(respond,error=>respond({ok:false,error:error.message}));return true;
});
