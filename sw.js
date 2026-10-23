// Offline shell. App files: network first (so a new version shows up at the next start),
// cache when offline. opencv.js (10 MB, rarely changes): cache first.
const CACHE='beleg-kamera-v4';
const SHELL=['./','index.html','app.js','detect.js','stitch.js','config.js','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  const key=u.pathname.endsWith('/')?new Request(u.origin+u.pathname):new Request(u.origin+u.pathname);
  if(u.pathname.endsWith('/opencv.js')){
    e.respondWith(caches.open(CACHE).then(async c=>(await c.match(key))||fetch(e.request).then(r=>{if(r.ok)c.put(key,r.clone());return r;})));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c=>{
    try{
      const r=await Promise.race([fetch(e.request,{cache:'no-cache'}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('slow')),4000))]);
      if(r.ok)c.put(key,r.clone());return r;
    }catch(err){const hit=await c.match(key);if(hit)return hit;throw err;}
  }));
});
