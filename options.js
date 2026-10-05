let categories=[],ready=false,timer,dragId,saveQueue=Promise.resolve();
const status=text=>document.getElementById('status').textContent=text;
function values(){return XPT.preferences({...Object.fromEntries(['gifFormat','gifWidth','gifFps','filenameStyle'].map(id=>[id,document.getElementById(id).value])),shareDomain:document.getElementById('domain').value,duplicateWarning:document.getElementById('duplicateWarning').checked,showProgress:document.getElementById('showProgress').checked})}
function cleanCategories(source){
  if(!Array.isArray(source)||source.length<1||source.length>20)throw Error('分類數量必須介於 1～20');
  const ids=new Set(),shortcuts=new Set();
  return source.map(c=>{
    if(typeof c.id!=='string'||!/^[\w-]{1,100}$/.test(c.id)||ids.has(c.id))throw Error('分類識別碼重複或無效');ids.add(c.id);
    const name=String(c.name||'').trim();if(!name||name.length>20)throw Error('分類名稱需 1～20 字');
    const shortcut=XPT.shortcut(c.shortcut);if(shortcut&&shortcuts.has(shortcut))throw Error('快捷鍵重複：'+shortcut);if(shortcut)shortcuts.add(shortcut);
    const destination=['directory','unbound'].includes(c.destination)?c.destination:'downloads';
    return {id:c.id,name,shortcut,destination,folder:destination==='downloads'?XPT.folder(c.folder):String(c.folder||'').slice(0,255),folderKey:typeof c.folderKey==='string'&&/^[\w-]{1,100}$/.test(c.folderKey)?c.folderKey:''};
  });
}
async function save(){
  if(!ready)return;
  const clean=cleanCategories(categories),prefs=values();
  const task=saveQueue.then(()=>chrome.storage.local.set({categories:clean,...prefs}));saveQueue=task.catch(()=>{});
  await task;status('已儲存，X 按鈕會自動更新');
}
function schedule(){if(!ready)return;clearTimeout(timer);status('尚未儲存');timer=setTimeout(()=>save().catch(error=>status(error.message)),450);updatePreview()}
function updatePreview(){document.getElementById('gif-fields').hidden=document.getElementById('gifFormat').value==='mp4';document.getElementById('filename-example').textContent=(document.getElementById('filenameStyle').value==='date'?new Date().toLocaleDateString('sv-SE')+'_':'')+'example_123456_01.jpg'}
function move(id,delta){const i=categories.findIndex(c=>c.id===id),to=i+delta;if(to<0||to>=categories.length)return;[categories[i],categories[to]]=[categories[to],categories[i]];render();schedule()}
function render(){
  const root=document.getElementById('categories');root.replaceChildren();
  for(const [index,category]of categories.entries()){
    const row=document.createElement('div');row.className='category';row.dataset.id=category.id;
    const drag=document.createElement('button');drag.className='icon drag';drag.textContent='↕';drag.title='拖曳排序';drag.draggable=true;
    drag.ondragstart=event=>{dragId=category.id;event.dataTransfer.setData('text/plain',category.id);row.classList.add('dragging')};drag.ondragend=()=>row.classList.remove('dragging');
    row.ondragover=event=>event.preventDefault();row.ondrop=event=>{event.preventDefault();const from=categories.findIndex(c=>c.id===dragId),to=categories.findIndex(c=>c.id===category.id);if(from<0||to<0)return;categories.splice(to,0,categories.splice(from,1)[0]);render();schedule()};
    const name=document.createElement('input');name.value=category.name;name.maxLength=20;name.setAttribute('aria-label','分類名稱');name.oninput=()=>{category.name=name.value;schedule()};
    const destination=document.createElement('div'),pick=document.createElement('button');pick.className='folder';
    const label=document.createElement('span');label.textContent=category.destination==='unbound'?'選擇既有資料夾':category.folder;
    const hint=document.createElement('small');hint.textContent=category.destination==='directory'?'更換資料夾':category.destination==='unbound'?'尚未綁定':'下載目錄內 · 可更換';pick.append(label,hint);
    pick.onclick=async()=>{try{
      if(typeof showDirectoryPicker!=='function')throw Error('瀏覽器未提供資料夾介面；Brave 可檢查 brave://flags/#file-system-access-api 並重啟');
      const handle=await showDirectoryPicker({id:'x-picture-tools',mode:'readwrite'});await XPTDirectories.set(category.id,handle);
      category.destination='directory';category.folder=handle.name;category.folderKey=crypto.randomUUID();render();await save();
    }catch(error){if(error.name!=='AbortError')status(error.message)}};
    destination.append(pick);
    if(category.destination==='directory')XPTDirectories.get(category.id).then(handle=>{
      if(!handle){hint.textContent='需要重新選擇資料夾';return}
      const grant=document.createElement('button');grant.className='grant';grant.textContent='重新授權';destination.append(grant);
      handle.queryPermission({mode:'readwrite'}).then(permission=>hint.textContent=permission==='granted'?'已授權 · 更換資料夾':'需重新授權').catch(()=>{});
      grant.onclick=async()=>{try{const permission=await handle.requestPermission({mode:'readwrite'});if(permission!=='granted')return status('尚未授權');await save();hint.textContent='已授權 · 更換資料夾';status('已授權並儲存')}catch(error){status(error.message)}};
    }).catch(error=>status(error.message));
    const shortcut=document.createElement('input');shortcut.className='shortcut';shortcut.placeholder='未設定';shortcut.value=category.shortcut||'';shortcut.setAttribute('aria-label','分類快捷鍵');shortcut.maxLength=6;
    shortcut.oninput=()=>{category.shortcut=shortcut.value;schedule()};shortcut.onkeydown=event=>{if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&/^[a-z0-9]$/i.test(event.key)){event.preventDefault();shortcut.value='Alt+'+event.key.toUpperCase();category.shortcut=shortcut.value;schedule()}};
    const controls=document.createElement('div');
    for(const [text,title,delta]of [['↑','上移',-1],['↓','下移',1]]){const button=document.createElement('button');button.className='icon';button.textContent=text;button.title=title;button.disabled=index+delta<0||index+delta>=categories.length;button.onclick=()=>move(category.id,delta);controls.append(button)}
    const remove=document.createElement('button');remove.className='icon';remove.textContent='×';remove.title='移除此分類';remove.disabled=categories.length===1;remove.onclick=()=>{categories=categories.filter(c=>c!==category);render();schedule()};controls.append(remove);
    row.append(drag,name,destination,shortcut,controls);root.append(row);
  }
}
chrome.storage.local.get(XPT.defaults).then(settings=>{categories=cleanCategories(settings.categories);const prefs=XPT.preferences(settings);for(const [id,value]of Object.entries(prefs)){const node=document.getElementById(id==='shareDomain'?'domain':id);if(node.type==='checkbox')node.checked=value;else node.value=String(value)}ready=true;render();updatePreview();status('設定已載入')}).catch(error=>status(error.message));
document.getElementById('add').onclick=()=>{if(categories.length>=20)return status('最多 20 個分類');categories.push({id:crypto.randomUUID(),name:'新分類',folder:'',destination:'unbound',shortcut:''});render();schedule()};
document.getElementById('save').onclick=()=>{clearTimeout(timer);save().catch(error=>status(error.message))};
for(const id of ['gifFormat','gifWidth','gifFps','filenameStyle','domain','duplicateWarning','showProgress'])document.getElementById(id).onchange=schedule;
document.getElementById('export').onclick=async()=>{try{clearTimeout(timer);await save();const data={schema:'x-picture-tools',version:1,categories:cleanCategories(categories),...values()};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='x-picture-tools-settings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);status('設定已匯出，不含資料夾授權')}catch(error){status(error.message)}};
document.getElementById('import').onclick=()=>document.getElementById('import-file').click();
document.getElementById('import-file').onchange=async event=>{try{
  const file=event.target.files[0];if(!file)return;if(file.size>256*1024)throw Error('設定檔太大');
  const raw=JSON.parse(await file.text());if(raw.schema!=='x-picture-tools'||raw.version!==1)throw Error('不是支援的設定備份');
  const clean=cleanCategories(raw.categories).map(c=>({...c,id:crypto.randomUUID(),destination:c.destination==='downloads'?'downloads':'unbound'}));
  if(!confirm('匯入將取代目前分類與設定。既有資料夾需重新選擇。確定繼續？'))return;
  clearTimeout(timer);categories=clean;const prefs=XPT.preferences(raw);for(const [id,value]of Object.entries(prefs)){const node=document.getElementById(id==='shareDomain'?'domain':id);if(node.type==='checkbox')node.checked=value;else node.value=String(value)}render();updatePreview();await save();status('已匯入；請重新選擇各分類的既有資料夾');
}catch(error){status(error instanceof SyntaxError?'設定檔不是有效 JSON，原有設定未變更':error.message)}finally{event.target.value=''}};
