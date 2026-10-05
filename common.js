(() => {
  const defaults = {categories: [{id: "default", name: "圖片", folder: "X圖片", shortcut: ''}], shareDomain: "fixupx.com", gifFormat:'gif', gifWidth:720, gifFps:15, filenameStyle:'author', duplicateWarning:true, showProgress:true};
  function folder(value) {
    const text = String(value || "").trim().replaceAll("\\", "/");
    if (!text || text.startsWith("/") || /^[a-z]:/i.test(text)) throw Error("請填下載目錄內的子資料夾，例如 X圖片/角色");
    const parts = text.split("/");
    if (parts.some(p => !p || p === "." || p === ".." || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error("資料夾名稱含無效字元或路徑");
    return parts.join("/");
  }
  function media(raw) {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" || !url.pathname.startsWith("/media/")) throw Error("不是 X 圖片網址");
    const pathMatch = url.pathname.match(/\.([a-z0-9]+)$/i);
    const format = (url.searchParams.get("format") || pathMatch?.[1] || "jpg").toLowerCase();
    if (!["jpg", "jpeg", "png", "webp"].includes(format)) throw Error("不支援此圖片格式");
    if (pathMatch) url.pathname = url.pathname.slice(0, -pathMatch[0].length);
    url.search = ""; url.searchParams.set("format", format); url.searchParams.set("name", "orig");
    return {url: url.href, format};
  }
  function postLink(raw, domain = "fixupx.com") {
    const url = new URL(raw);
    if (!["x.com", "twitter.com"].includes(url.hostname)) throw Error("不是 X 貼文連結");
    const match = url.pathname.match(/^\/([\w]+)\/status\/(\d+)/);
    if (!match) throw Error("找不到貼文連結");
    if (!["fixupx.com", "fxtwitter.com", "vxtwitter.com"].includes(domain)) throw Error("無效分享網域");
    return `https://${domain}/${match[1]}/status/${match[2]}`;
  }
  function asset(raw) {
    if (typeof raw === 'string' || raw?.type === 'photo') return {...media(typeof raw === 'string' ? raw : raw.url), type:'photo'};
    if (!raw || !['animated_gif','video'].includes(raw.type)) throw Error('不支援此媒體');
    const u = new URL(raw.url);
    if (u.protocol !== 'https:' || u.hostname !== 'video.twimg.com' || u.username || u.password || !u.pathname.endsWith('.mp4')) throw Error('不是 X MP4 網址');
    return {url:u.href,type:raw.type,format:'mp4'};
  }
  function preferences(raw) {
    return {shareDomain:['fixupx.com','fxtwitter.com','vxtwitter.com'].includes(raw.shareDomain)?raw.shareDomain:defaults.shareDomain,
      gifFormat:raw.gifFormat==='mp4'?'mp4':'gif',gifWidth:[0,480,720].includes(Number(raw.gifWidth))?Number(raw.gifWidth):720,
      gifFps:[10,15,20,30].includes(Number(raw.gifFps))?Number(raw.gifFps):15,filenameStyle:raw.filenameStyle==='date'?'date':'author',
      duplicateWarning:raw.duplicateWarning!==false,showProgress:raw.showProgress!==false};
  }
  function shortcut(raw) {
    const s=String(raw||'').trim(); if (!s) return '';
    if (!/^Alt\+[1-9A-Z]$/i.test(s)) throw Error('快捷鍵格式請用 Alt+1～9 或 Alt+A～Z');
    return 'Alt+'+s.slice(4).toUpperCase();
  }
  globalThis.XPT = {defaults, folder, media, asset, preferences, shortcut, postLink};
})();
