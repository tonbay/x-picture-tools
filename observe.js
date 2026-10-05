// Passive observation only: no extra API requests, credentials or account actions.
(() => {
  const users = new Map(), posts = new Map();
  function send() { window.postMessage({source: "xpt-data-v1", users: [...users.values()].slice(-1000), posts: [...posts.values()].slice(-1000)}, location.origin); }
  let scheduled;
  function parse(data) {
    const visited = new WeakSet(); let budget = 60000;
    function walk(node) {
      if (!node || typeof node !== "object" || visited.has(node) || --budget < 0) return;
      visited.add(node);
      const legacy = node.legacy;
      const handle = node.core?.screen_name || legacy?.screen_name;
      if (handle && node.rest_id && (node.__typename === "User" || legacy?.screen_name)) {
        const relationships = node.relationship_perspectives || {};
        const following = typeof legacy?.following === "boolean" ? legacy.following : relationships.following;
        const blocking = typeof legacy?.blocking === "boolean" ? legacy.blocking : relationships.blocking;
        const prev = users.get(handle.toLowerCase()) || {};
        users.set(handle.toLowerCase(), {handle, id: String(node.rest_id), following: typeof following === "boolean" ? following : prev.following, blocking: typeof blocking === "boolean" ? blocking : prev.blocking});
      }
      if (node.rest_id && legacy?.full_text !== undefined) {
        const result = node.core?.user_results?.result;
        const author = result?.core?.screen_name || result?.legacy?.screen_name;
        const media = (legacy.extended_entities?.media || legacy.entities?.media || []).flatMap(m => {
          if (m.type === 'photo') return [{type:'photo',url:m.media_url_https}];
          const variants=(m.video_info?.variants||[]).filter(v=>v.content_type==='video/mp4').sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
          return variants[0] && ['animated_gif','video'].includes(m.type) ? [{type:m.type,url:variants[0].url}] : [];
        });
        const images=media.filter(m=>m.type==='photo').map(m=>m.url);
        if (author) posts.set(String(node.rest_id), {id: String(node.rest_id), author, images, media});
      }
      for (const child of Object.values(node)) walk(child);
    }
    walk(data);
    while (users.size > 1000) users.delete(users.keys().next().value);
    while (posts.size > 1000) posts.delete(posts.keys().next().value);
    clearTimeout(scheduled); scheduled = setTimeout(send, 80);
  }
  function relevant(raw) { try { const u = new URL(raw, location.href); return ["x.com", "twitter.com", "api.x.com", "api.twitter.com"].includes(u.hostname) && /\/graphql\/|\/1\.1\//.test(u.pathname); } catch { return false; } }
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const promise = originalFetch.apply(this, args);
    if (relevant(args[0]?.url || args[0])) promise.then(response => { if (response.ok) response.clone().json().then(parse).catch(() => {}); }).catch(() => {});
    return promise;
  };
  const open = XMLHttpRequest.prototype.open, sendXHR = XMLHttpRequest.prototype.send;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function(method, url, ...args) { urls.set(this, url); return open.call(this, method, url, ...args); };
  XMLHttpRequest.prototype.send = function(...args) {
    if (relevant(urls.get(this))) this.addEventListener("load", () => { try { parse(this.responseType === "json" ? this.response : JSON.parse(this.responseText)); } catch {} }, {once: true});
    return sendXHR.apply(this, args);
  };
  window.addEventListener("message", event => { if (event.source === window && event.origin === location.origin && event.data?.source === "xpt-request-v1") send(); });
})();
