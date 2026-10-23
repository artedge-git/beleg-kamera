// Offline shell: answer from the cache at once and refresh it in the background,
// so a new version is used from the next start on. opencv.js is cached the first time it is needed.
const CACHE='beleg-kamera-v1';
const SHELL=['./','index.html','app.js','detect.js','stitch.js','config.js','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  const key=u.pathname.endsWith('/')?new Request(u.origin+u.pathname):e.request;
  e.respondWith(caches.open(CACHE).then(async c=>{
    const hit=await c.match(key,{ignoreSearch:true});
    const net=fetch(e.request).then(r=>{if(r.ok)c.put(key,r.clone());return r;});
    if(hit){e.waitUntil(net.catch(()=>{}));return hit;}
    return net;
  }));
});
