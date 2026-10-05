(() => {
  let settings = XPT.defaults, activeAction = false, scanTimer, toastTimer;
  const users = new Map(), posts = new Map();
  const rails = new Map(), pending = new Map(); let galleryRail, hoveredArticle;
  const visible = element => !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== "hidden";
  function toast(text) { let node = document.querySelector(".xpt-toast"); if (!node) { node = document.createElement("div"); node.className = "xpt-toast"; node.setAttribute("role", "status"); document.body.append(node); } node.textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => node.remove(), 4200); }
  function parseLink(raw) { try { const u = new URL(raw, location.href); const m = u.pathname.match(/^\/(\w+)\/status\/(\d+)(?:\/(?:photo|video)\/(\d+))?/); return m && {author: m[1], id: m[2], index: Number(m[3] || 1), url: `https://x.com/${m[1]}/status/${m[2]}`}; } catch { return null; } }
  function ownNode(node, article) { return node.closest('article[data-testid="tweet"]') === article && !node.closest('[data-testid="quoteTweet"]'); }
  function articleInfo(article) {
    const times = [...article.querySelectorAll('time')].filter(node => ownNode(node, article));
    for (const time of times) { const info = parseLink(time.closest('a[href*="/status/"]')?.href); if (info) return info; }
    const links = [...article.querySelectorAll('a[href*="/status/"]')].filter(node => ownNode(node, article));
    for (const link of links.filter(node => /\/(photo|video)\/\d+/.test(node.pathname))) { const info = parseLink(link.href); if (info) return info; }
    for (const link of links.filter(node => !node.closest('[data-testid="tweetText"]'))) { const info = parseLink(link.href); if (info) return info; }
    return null;
  }
  function articleMedia(article, context) {
    const nodes = [...article.querySelectorAll('[data-testid="tweetPhoto"],[data-testid="videoPlayer"],img[src*="pbs.twimg.com/media/"],video')].filter(node => {
      if (!ownNode(node, article)) return false;
      const linked = parseLink(node.closest('a[href*="/status/"]')?.href);
      return !linked || linked.id === context.id;
    });
    return nodes.filter(node => !nodes.some(parent => parent !== node && parent.contains(node)));
  }
  function domImages(root) { const primary = articleInfo(root); return [...new Set([...root.querySelectorAll('img[src*="pbs.twimg.com/media/"]')].filter(img => { if (img.closest('[data-testid="quoteTweet"]')) return false; const linked = parseLink(img.closest('a[href*="/status/"]')?.href); return !linked || !primary || linked.id === primary.id; }).map(img => img.currentSrc || img.src))]; }
  function mediaFor(context) {
    if (context.media) return context.media;
    const cached=posts.get(context.id)?.media;
    if(cached?.length)return cached;
    const media=domImages(context.article).map(url=>({type:'photo',url}));
    const videos=[...context.article.querySelectorAll('video')].filter(v=>!v.closest('[data-testid="quoteTweet"]'));
    for(const video of videos){const url=video.currentSrc||video.src;if(/^https:\/\/video\.twimg\.com\/.+\.mp4(?:\?|$)/.test(url))media.push({type:'video',url});else if(!media.length)throw Error('尚未取得 GIF／影片原檔，請重新整理 X 或捲動讓媒體載入')}
    return media;
  }
  function railStatus(rail,text,percent) {
    const node=rail.parentElement.querySelector('.xpt-status');if(!node)return;
    node.replaceChildren();node.hidden=!settings.showProgress;
    node.textContent=text;
    if(Number.isFinite(percent)){const progress=document.createElement('progress');progress.max=100;progress.value=Math.max(0,Math.min(100,percent));node.append(progress)}
  }
  async function download(rail,category,force=false,retry=false) {
    if(rail.busy)return;
    const current=rail.context,requestId=crypto.randomUUID(),media=mediaFor(current);
    rail.busy=true;pending.set(requestId,rail);rail.parentElement.querySelector('.xpt-notice')?.remove();
    for(const b of rail.querySelectorAll('.xpt-category'))b.disabled=true;
    railStatus(rail,'等待下載');
    try{
      const result=await chrome.runtime.sendMessage({type:'download',media,images:media.filter(m=>m.type==='photo').map(m=>m.url),categoryId:category.id,author:current.author,postId:current.id,startIndex:current.media?current.index:1,requestId,force,retry});
      if(result?.duplicate){
        railStatus(rail,'');const notice=document.createElement('div');notice.className='xpt-notice';notice.textContent=`部分或全部媒體已下載到「${category.name}」。`;
        const again=document.createElement('button');again.textContent='仍要下載';again.onclick=e=>{e.stopPropagation();void download(rail,category,true)};
        const skip=document.createElement('button');skip.textContent='只補未下載';skip.onclick=e=>{e.stopPropagation();void download(rail,category,false,true)};
        const cancel=document.createElement('button');cancel.textContent='取消';cancel.onclick=e=>{e.stopPropagation();notice.remove()};notice.append(again,skip,cancel);rail.parentElement.append(notice);return;
      }
      if(!result?.ok)throw Error(result?.error||'下載失敗');
      railStatus(rail,`✓ 已存入「${category.name}」· ${result.count} 個檔案`);toast(`已存入「${category.name}」· ${result.count} 個檔案`);
    }catch(error){
      railStatus(rail,error.message);toast(error.message);const notice=document.createElement('div');notice.className='xpt-notice';
      const retryButton=document.createElement('button');retryButton.textContent='重試';retryButton.onclick=e=>{e.stopPropagation();void download(rail,category,false,true)};notice.append(retryButton);rail.parentElement.append(notice);
    }finally{pending.delete(requestId);rail.busy=false;for(const b of rail.querySelectorAll('.xpt-category'))b.disabled=false}
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(fn, timeout = 2500) { const until = Date.now() + timeout; while (Date.now() < until) { const result = fn(); if (result) return result; await sleep(60); } throw Error("X 介面未回應；請稍後再試或使用原生選單"); }
  function nativeMenu() { return [...document.querySelectorAll('[role="menu"]')].find(visible); }
  function menuItem(menu, selector, matcher) { const direct = [...menu.querySelectorAll(selector)].find(visible); return direct || [...menu.querySelectorAll('[role="menuitem"]')].find(el => matcher.test(el.textContent)); }
  async function openMenu(article) { const caret = article?.querySelector('[data-testid="caret"]'); if (!caret) throw Error("找不到該貼文選單；請回貼文外層操作"); if (nativeMenu()) document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); caret.click(); return waitFor(nativeMenu); }
  function closeMenu(menu) { menu?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", bubbles: true})); }
  async function accountAction(context, kind) {
    if (activeAction) throw Error("上一個操作尚未完成");
    const article = context.article?.isConnected ? context.article : [...document.querySelectorAll('article[data-testid="tweet"]')].find(a => articleInfo(a)?.id === context.id);
    activeAction = true; let menu;
    try {
      menu = await openMenu(article);
      if (kind === "follow") {
        const unfollow = menuItem(menu, '[data-testid$="-unfollow"]', /^(取消跟隨|取消关注|取消關注|Unfollow)\b|^取消跟隨|^取消关注|^取消關注/i);
        const follow = unfollow || menuItem(menu, '[data-testid$="-follow"]', /^(跟隨|关注|關注|Follow)\s/i);
        if (!follow) { closeMenu(menu); throw Error("此作者沒有可用的跟隨操作"); }
        follow.click();
        if (unfollow) { const confirm = await waitFor(() => [...document.querySelectorAll('[data-testid="confirmationSheetConfirm"]')].find(visible)); confirm.click(); }
        users.set(context.author.toLowerCase(), {...users.get(context.author.toLowerCase()), following: !unfollow});
        toast(unfollow ? "已取消跟隨" : "已跟隨作者");
      } else {
        const unblock = menuItem(menu, '[data-testid="unblock"]', /^(解除封鎖|取消屏蔽|取消封鎖|Unblock)/i);
        const block = unblock || menuItem(menu, '[data-testid="block"]', /^(封鎖|屏蔽|Block)\s/i);
        if (!block) { closeMenu(menu); throw Error("找不到原生封鎖操作"); }
        block.click();
        const confirm = await waitFor(() => [...document.querySelectorAll('[data-testid="confirmationSheetConfirm"]')].find(visible)); confirm.click();
        users.set(context.author.toLowerCase(), {...users.get(context.author.toLowerCase()), blocking: !unblock, ...(!unblock ? {following: false} : {})});
        if (unblock) toast("已解除封鎖；不會自動重新跟隨");
        // Blocking uses X's own flow, retaining its native undo message.
      }
    } finally { activeAction = false; queueScan(); }
  }
  async function refreshRelationship(context) {
    if (activeAction) return;
    activeAction = true; let menu;
    try {
      menu = await openMenu(context.article);
      const unfollow = menuItem(menu, '[data-testid$="-unfollow"]', /^(取消跟隨|取消关注|取消關注|Unfollow)/i);
      const follow = menuItem(menu, '[data-testid$="-follow"]', /^(跟隨|关注|關注|Follow)\s/i);
      if (unfollow || follow) users.set(context.author.toLowerCase(), {...users.get(context.author.toLowerCase()), following: !!unfollow});
    } catch (error) { toast(error.message); } finally { closeMenu(menu); activeAction = false; queueScan(); }
  }
  const icons = {follow: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M16 11h6"/>', following: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 10l2 2 4-4"/>', unknown: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 8a2 2 0 1 1 2 2v2M20 15h.01"/>', block: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>', unblock: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', share: '<path d="M12 16V3m-5 5 5-5 5 5M4 13v8h16v-8"/>'};
  function icon(node, kind, label) { node.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[kind]}</svg>`; if (label) { const span = document.createElement('span'); span.textContent = label; node.append(span); } }
  function button(text, title, cls, handler) { const node = document.createElement("button"); node.type = "button"; icon(node, cls?.includes('xpt-block') ? 'block' : text === 'DC' ? 'share' : cls?.includes('xpt-round') ? 'unknown' : 'download', cls?.includes('xpt-round') ? null : text); node.title = title; node.setAttribute("aria-label", title); node.className = cls || "xpt-category"; node.addEventListener("click", async event => { event.preventDefault(); event.stopPropagation(); node.disabled = true; try { await handler(event); } catch (error) { toast(error.message); } finally { node.disabled = false; } }); return node; }
  function createRail(context, gallery = false) {
    const rail = document.createElement("div"); rail.className = `xpt-rail${gallery ? " xpt-gallery" : ""}`; rail.setAttribute("aria-label", "X 圖片工具");
    const shell=document.createElement('div');shell.className=`xpt-shell${gallery?' xpt-gallery-shell':''}`;shell.append(rail);rail.shell=shell;
    const status=document.createElement('div');status.className='xpt-status';status.setAttribute('role','status');status.hidden=true;shell.append(status);shell.addEventListener('click',e=>e.stopPropagation());
    rail.addEventListener("click", e => e.stopPropagation());
    const follow = button("狀態未知", "跟隨狀態未知；點擊執行原生跟隨／取消跟隨。Shift＋點擊只查狀態", "xpt-round", async event => { const current = rail.context; if (event.shiftKey) await refreshRelationship(current); else await accountAction(current, "follow"); });
    follow.dataset.kind = "follow"; rail.append(follow);
    const block = button("封鎖", "封鎖作者；已封鎖時可解除", "xpt-round xpt-block", () => accountAction(rail.context, "block")); block.dataset.kind = "block"; rail.append(block);
    const categories = document.createElement("div"); categories.className = "xpt-categories";
    for (const category of settings.categories) {
      const node=button(category.name, `${gallery ? "下載目前媒體" : "下載整篇媒體"} → ${category.folder}${category.shortcut?' · '+category.shortcut:''}`, "", ()=>download(rail,category));node.dataset.category=category.id;categories.append(node);
    } rail.append(categories);
    rail.append(button("DC", "複製 Discord 預覽連結", "xpt-round", async () => { await navigator.clipboard.writeText(XPT.postLink(rail.context.url, settings.shareDomain)); toast("已複製 DC 預覽連結"); }));
    rail.context = context; return rail;
  }
  function updateRail(rail) { const state = users.get(rail.context.author.toLowerCase()) || {}; const follow = rail.querySelector('[data-kind="follow"]'); const kind = state.following === true ? 'following' : state.following === false ? 'follow' : 'unknown'; if (follow.dataset.icon !== kind) { icon(follow, kind); follow.dataset.icon = kind; } follow.title = state.following === true ? '已跟隨 · 點擊取消跟隨' : state.following === false ? '點擊跟隨作者' : '跟隨狀態未知；點擊執行原生跟隨／取消跟隨。Shift＋點擊只查狀態'; follow.setAttribute('aria-label', follow.title); follow.classList.toggle("xpt-following", state.following === true); const block = rail.querySelector('[data-kind="block"]'); const blockKind = state.blocking === true ? 'unblock' : 'block'; if (block.dataset.icon !== blockKind) { icon(block, blockKind); block.dataset.icon = blockKind; } block.title = state.blocking === true ? '解除封鎖作者' : '封鎖作者'; block.setAttribute('aria-label', block.title); }
  function scan() {
    if (!document.body) return;
    for (const [article, rail] of rails) if (!article.isConnected) { rail.shell.remove(); rails.delete(article); }
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (article.closest('[role="dialog"]')) continue;
      const context = articleInfo(article); if (!context) continue;
      const photos = articleMedia(article, context);
      if (!photos.length) { const old = rails.get(article); if (old) { old.shell.remove(); rails.delete(article); } continue; }
      let mediaRoot = photos[0];
      while (mediaRoot.parentElement && mediaRoot.parentElement !== article && !photos.every(p => mediaRoot.contains(p))) mediaRoot = mediaRoot.parentElement;
      if (photos.length === 1) mediaRoot = photos[0].closest('a[href*="/photo/"]') || photos[0];
      // X wraps media in fixed-height / overflow-hidden containers. Insert after
      // the outer media-only wrapper, rather than inside a clipped image frame.
      while(mediaRoot.parentElement&&mediaRoot.parentElement!==article){
        const parent=mediaRoot.parentElement;
        if(parent.querySelector('time,[data-testid="User-Name"],[data-testid="tweetText"],[data-testid="socialContext"],[data-testid="caret"],[data-testid="like"],[data-testid="unlike"],[data-testid="reply"],[data-testid="retweet"],[data-testid="unretweet"],[data-testid="quoteTweet"]'))break;
        mediaRoot=parent;
      }
      if (mediaRoot === article || (!visible(mediaRoot) && !photos.some(node => visible(node) || [...node.querySelectorAll('img,video')].some(visible)))) continue;
      // A real row below the complete media group, outside the photo link.
      let rail = rails.get(article);
      if (rail && rail.context.id !== context.id) { rail.shell.remove(); rails.delete(article); rail = null; }
      if (!rail) { rail = createRail({...context, article}); rails.set(article, rail); }
      if(mediaRoot.nextElementSibling!==rail.shell)mediaRoot.after(rail.shell);
      rail.context = {...context, article};
      updateRail(rail);
    }
    const modal = [...document.querySelectorAll('[role="dialog"]')].find(d => visible(d) && d.querySelector('img[src*="pbs.twimg.com/media/"],video'));
    const context = parseLink(location.href);
    if (!modal || !context || !/\/(photo|video)\/\d+/.test(location.pathname)) { galleryRail?.shell.remove(); galleryRail = null; return; }
    const images = [...modal.querySelectorAll('img[src*="pbs.twimg.com/media/"]')].filter(img => { const r = img.getBoundingClientRect(); return visible(img) && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; }).sort((a,b) => { const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(); return br.width*br.height-ar.width*ar.height; });
    const image = images[0],video=[...modal.querySelectorAll('video')].find(visible); if (!image&&!video) return;
    const article = [...document.querySelectorAll('article[data-testid="tweet"]')].find(a => articleInfo(a)?.id === context.id);
    const cached=posts.get(context.id)?.media;const selected=cached?.[context.index-1];
    const media=selected?[selected]:image?[{type:'photo',url:image.currentSrc||image.src}]:video?.currentSrc?.startsWith('https://video.twimg.com/')?[{type:'video',url:video.currentSrc}]:[];
    if (!galleryRail) { galleryRail = createRail(context, true); document.body.append(galleryRail.shell); }
    galleryRail.context = {...context, article, media}; updateRail(galleryRail);
  }
  function queueScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 100); }
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "xpt-data-v1") return;
    for (const user of (Array.isArray(event.data.users) ? event.data.users : []).slice(0,1000)) if (/^\w{1,50}$/.test(user.handle)) users.set(user.handle.toLowerCase(), user);
    for (const post of (Array.isArray(event.data.posts) ? event.data.posts : []).slice(0,1000)) if (/^\d+$/.test(post.id) && /^\w{1,50}$/.test(post.author) && (Array.isArray(post.images)||Array.isArray(post.media))) posts.set(post.id, post);
    queueScan();
  });
  chrome.storage.local.get(XPT.defaults).then(value => { settings = value; queueScan(); });
  chrome.storage.onChanged.addListener(changes => { if(!Object.keys(changes).some(key=>key in XPT.defaults))return;chrome.storage.local.get(XPT.defaults).then(value => { settings = value; for (const rail of rails.values()) rail.shell.remove(); rails.clear(); galleryRail?.shell.remove(); galleryRail = null; queueScan(); }); });
  chrome.runtime.onMessage?.addListener(message=>{if(message?.type==='download-progress'){const rail=pending.get(message.requestId);if(rail)railStatus(rail,message.text,message.percent)}});
  document.addEventListener('pointerover',event=>{hoveredArticle=event.target.closest?.('article[data-testid="tweet"]')||null});
  document.addEventListener('keydown',event=>{
    if(event.repeat||event.ctrlKey||event.metaKey||event.shiftKey||!event.altKey||event.target.closest?.('input,textarea,[contenteditable="true"],[role="textbox"]'))return;
    const category=settings.categories.find(c=>c.shortcut===('Alt+'+event.key.toUpperCase()));if(!category)return;
    const rail=galleryRail||rails.get(hoveredArticle);if(!rail)return;event.preventDefault();void download(rail,category);
  });
  new MutationObserver(records => { if (records.some(r => !r.target.closest?.('.xpt-shell,.xpt-toast') && [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !n.matches?.('.xpt-shell,.xpt-toast')))) queueScan(); }).observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener("resize", queueScan); window.addEventListener("popstate", queueScan);
  setInterval(scan, 1200);
  window.postMessage({source: "xpt-request-v1"}, location.origin);
})();
