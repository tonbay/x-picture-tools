importScripts('common.js','directories.js');
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
let queue=Promise.resolve(),offscreenPromise,queued=0;
const jobs=new Map();
async function progress(job,text,percent) {
  if(job.tabId===undefined)return;
  await chrome.tabs.sendMessage(job.tabId,{type:'download-progress',requestId:job.requestId,text,percent}).catch(()=>{});
}
async function ensureOffscreen(){
  if(offscreenPromise)return offscreenPromise;
  offscreenPromise=(async()=>{
    if(!await chrome.offscreen.hasDocument())await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'在本機解碼 MP4、編碼 GIF 並保存轉檔 Blob'});
  })().finally(()=>offscreenPromise=null);
  return offscreenPromise;
}
async function waitDownload(id,job) {
  const until=Date.now()+10*60*1000;
  while(Date.now()<until){
    const [item]=await chrome.downloads.search({id});
    if(!item)throw Error('找不到下載工作');
    if(item.state==='complete')return;
    if(item.state==='interrupted')throw Error('下載中斷：'+(item.error||'請重試'));
    if(item.totalBytes>0)await progress(job,'下載中',Math.round(item.bytesReceived/item.totalBytes*100));
    await new Promise(r=>setTimeout(r,500));
  }
  throw Error('下載尚未完成，請查看瀏覽器下載紀錄後再重試');
}
async function fingerprint(asset,category,prefs){
  const u=new URL(asset.url);const variant=asset.type==='animated_gif'&&prefs.gifFormat==='gif'?`gif:${prefs.gifWidth}:${prefs.gifFps}`:asset.format;
  const bytes=new TextEncoder().encode([u.origin+u.pathname,category.id,category.folder,category.folderKey||'',category.destination||'downloads',variant].join('|'));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
async function save(message,sender){
  const settings=await chrome.storage.local.get(XPT.defaults),prefs=XPT.preferences(settings);
  const category=settings.categories.find(c=>c.id===message.categoryId);
  if(!category)throw Error('分類已移除，請重新選擇');
  if(category.destination==='unbound') { await chrome.runtime.openOptionsPage();throw Error('此分類尚未選擇資料夾，請在設定頁選擇後重試'); }
  const source=message.media||message.images;
  if(!Array.isArray(source)||!source.length||source.length>16)throw Error('沒有可下載媒體；GIF 請重新整理 X 讓插件讀取媒體資訊');
  if(!/^\d+$/.test(String(message.postId))||!/^\w{1,50}$/.test(message.author))throw Error('無法確認媒體所屬貼文');
  const start=message.startIndex===undefined?1:message.startIndex;
  if(!Number.isInteger(start)||start<1||start>16)throw Error('媒體編號不正確');
  const assets=source.map(XPT.asset).filter((m,i,all)=>all.findIndex(n=>n.url===m.url)===i);
  let handle;
  const directory=category.destination==='directory'?'':XPT.folder(category.folder);
  if(category.destination==='directory'){
    handle=await XPTDirectories.get(category.id);
    if(!handle||await handle.queryPermission({mode:'readwrite'})!=='granted'){
      await chrome.runtime.openOptionsPage();throw Error('資料夾需重新授權；請在設定頁授權後重試');
    }
  }
  const history=(await chrome.storage.local.get({downloadHistory:{}})).downloadHistory;
  const keys=await Promise.all(assets.map(a=>fingerprint(a,category,prefs)));
  if(prefs.duplicateWarning&&!message.force&&!message.retry&&keys.some(key=>history[key]))return {ok:true,duplicate:true,count:0};
  const job={tabId:sender.tab?.id,requestId:message.requestId};let count=0;
  const heartbeat=setInterval(()=>chrome.runtime.getPlatformInfo(),20000);
  try{
    for(const [index,asset]of assets.entries()){
      const key=keys[index];
      // Successful files from a partly failed batch are not downloaded again on retry.
      if(prefs.duplicateWarning&&!message.force&&history[key])continue;
      const id=crypto.randomUUID();jobs.set(id,job);
      const converted=asset.type==='animated_gif'&&prefs.gifFormat==='gif';
      const extension=converted?'gif':asset.format;
      const prefix=prefs.filenameStyle==='date'?new Date().toLocaleDateString('sv-SE')+'_':'';
      const filename=`${prefix}${message.author}_${message.postId}_${String(start+index).padStart(2,'0')}.${extension}`;
      let blob;
      try{
        await progress(job,`下載中 · ${index+1} / ${assets.length}`);
        if(converted){
          await ensureOffscreen();
          const result=await chrome.runtime.sendMessage({type:'convert-gif',jobId:id,url:asset.url,...prefs});
          if(!result?.ok)throw Error(result?.error||'GIF 轉檔失敗');
          blob=await XPTDirectories.get('blob:'+id);if(!blob)throw Error('轉檔結果遺失，請重試');
        }
        if(handle){
          const file=await XPTDirectories.uniqueFile(handle,filename);
          let writable;
          try{
            writable=await file.createWritable();
            if(blob)await blob.stream().pipeTo(writable);
            else{
              const response=await fetch(asset.url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(120000)});
              const expected=asset.type==='photo'?/^image\/(jpeg|png|webp)(?:;|$)/i:/^video\/mp4(?:;|$)/i;
              if(!response.ok||!expected.test(response.headers.get('content-type')||''))throw Error('伺服器未回傳有效媒體');
              const reader=response.body.getReader();let received=0;const total=Number(response.headers.get('content-length'));
              try{for(;;){const {done,value}=await reader.read();if(done)break;await writable.write(value);received+=value.length;if(total)await progress(job,`下載中 · ${index+1} / ${assets.length}`,Math.round(received/total*100))}}finally{reader.releaseLock()}
              await writable.close();
            }
          }catch(error){await writable?.abort().catch(()=>{});await handle.removeEntry(file.name).catch(()=>{});throw error}
        }else if(!blob){
          const downloadId=await chrome.downloads.download({url:asset.url,filename:directory+'/'+filename,conflictAction:'uniquify',saveAs:false});
          await waitDownload(downloadId,job);
        }
        if(!handle&&blob){
          // Blob URL lives in the offscreen document until the browser finishes saving.
          const result=await chrome.runtime.sendMessage({type:'gif-blob-url',jobId:id});
          if(!result?.url)throw Error('無法取得 GIF 下載網址');
          try{const downloadId=await chrome.downloads.download({url:result.url,filename:directory+'/'+filename,conflictAction:'uniquify',saveAs:false});await waitDownload(downloadId,job)}
          finally{await chrome.runtime.sendMessage({type:'gif-blob-release',jobId:id}).catch(()=>{})}
        }
        history[key]=Date.now();count++;
        const trimmed=Object.fromEntries(Object.entries(history).sort((a,b)=>b[1]-a[1]).slice(0,3000));
        await chrome.storage.local.set({downloadHistory:trimmed});
      }finally{jobs.delete(id);await XPTDirectories.remove('blob:'+id).catch(()=>{})}
    }
    await progress(job,`✓ 已存入「${category.name}」· ${count} 個檔案`);
    return {ok:true,count,mode:'directory'};
  }catch(error){await progress(job,`已存入 ${count} 個；${error.message}`);throw Error(`已存入 ${count} 個；${error.message}`)}
  finally{clearInterval(heartbeat);if(await chrome.offscreen.hasDocument().catch(()=>false))await chrome.offscreen.closeDocument().catch(()=>{})}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='conversion-progress'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('offscreen.html')){
    const job=jobs.get(message.jobId);if(job)void progress(job,'GIF 轉檔中',message.percent);return;
  }
  const source=sender.url||sender.tab?.url||'';
  if(!/^https:\/\/(x|twitter)\.com\//.test(source)||message?.type!=='download')return;
  if(queued>=8){respond({ok:false,error:'下載工作較多，請稍後重試'});return}
  queued++;
  const task=queue.then(()=>save(message,sender)).finally(()=>queued--);queue=task.catch(()=>{});
  task.then(respond,error=>respond({ok:false,error:error.message}));return true;
});
