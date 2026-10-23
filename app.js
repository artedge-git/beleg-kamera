// Beleg-Kamera: live camera with receipt detection and auto capture, long receipts in several
// pieces joined by feature matching, upload straight into the Dropbox _Eingang with an offline queue.
(function(){
'use strict';
const VERSION='1.5';
const CFG=Object.assign({dropboxAppKey:'',ziel:'/_artedge eU/bookdesk/_Eingang'},window.BELEG_CONFIG||{});
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const stamp=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'_'+pad(d.getHours())+'-'+pad(d.getMinutes())+'-'+pad(d.getSeconds());
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}},del(k){try{localStorage.removeItem(k);}catch(e){}}};

let toastT=0;
function toast(msg,ms){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,ms||3200);}
function busy(msg){$('busy').hidden=!msg;if(msg)$('busyText').textContent=msg;}
function screen(name){['cam','review','sheet'].forEach(s=>$(s).hidden=s!==name);}

// ---------------------------------------------------------------- camera
const video=$('vf'),ov=$('ov'),octx=ov.getContext('2d');
let stream=null,track=null,running=false,auto=store.get('auto',true);
let dbgOn=store.get('dbg',false),dbgTaps=0,live=null,smooth=null,jumps=0,frames=[],stableSince=0,needMotion=false,armAt=0,prevLum=null,loopT=0;
let pieces=[];             // canvases of the pieces of the current receipt, already cropped
let shot=null,quad=null;   // the captured frame under review and the receipt's corners TL,TR,BR,BL (fractions)

async function startCamera(){
  $('camerr').hidden=true;$('hint').textContent='Kamera wird gestartet …';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){camError('Dieser Browser gibt die Kamera nicht frei. Nimm die Mediathek oder öffne die Seite in Safari.');return;}
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160}}});
  }catch(e){
    try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'environment'}});}
    catch(e2){camError(e2&&e2.name==='NotAllowedError'?'Die Kamera ist nicht erlaubt. Tippe auf „Kamera starten“ und erlaube den Zugriff.':'Die Kamera ließ sich nicht starten.');return;}
  }
  track=stream.getVideoTracks()[0];
  try{const c=track.getCapabilities&&track.getCapabilities();
    if(c&&c.focusMode&&c.focusMode.includes('continuous'))track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
    $('torch').hidden=!(c&&c.torch);}catch(e){}
  video.srcObject=stream;
  try{await video.play();}catch(e){camError('Tippe auf „Kamera starten“.');return;}
  running=true;armAt=performance.now()+700;sizeOverlay();loop();
}
function stopCamera(){running=false;clearTimeout(loopT);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;track=null;}
function camError(msg){$('camerrText').textContent=msg;$('camerr').hidden=false;$('hint').textContent='';}
$('camStart').addEventListener('click',startCamera);

function sizeOverlay(){const d=Math.min(2,devicePixelRatio||1);ov.width=Math.round(innerWidth*d);ov.height=Math.round(innerHeight*d);octx.setTransform(d,0,0,d,0,0);}
addEventListener('resize',()=>{sizeOverlay();if(!$('review').hidden)drawReview();});

// where the video's pixel (fx,fy as fractions) shows on screen (object-fit: cover)
function toScreen(fx,fy){const vw=video.videoWidth,vh=video.videoHeight,cw=innerWidth,ch=innerHeight,s=Math.max(cw/vw,ch/vh);
  return [fx*vw*s+(cw-vw*s)/2,fy*vh*s+(ch-vh*s)/2];}
function iou(a,b){const x0=Math.max(a.x0,b.x0),y0=Math.max(a.y0,b.y0),x1=Math.min(a.x1,b.x1),y1=Math.min(a.y1,b.y1);
  const i=Math.max(0,x1-x0)*Math.max(0,y1-y0),u=(a.x1-a.x0)*(a.y1-a.y0)+(b.x1-b.x0)*(b.y1-b.y0)-i;return u>0?i/u:0;}

const small=document.createElement('canvas'),sctx=small.getContext('2d',{willReadFrequently:true});
function loop(){
  if(!running)return;
  const t0=performance.now();
  if(video.readyState>=2&&video.videoWidth){
    const W=video.videoWidth,H=video.videoHeight,s=360/Math.max(W,H),w=Math.round(W*s),h=Math.round(H*s);
    if(small.width!==w||small.height!==h){small.width=w;small.height=h;prevLum=null;}
    sctx.drawImage(video,0,0,w,h);const d=sctx.getImageData(0,0,w,h).data;
    // motion: mean brightness change against the last frame, on every 4th pixel
    const n=w*h,lum=new Uint8Array(Math.ceil(n/4));let diff=0;
    for(let i=0,j=0;i<n;i+=4,j++){lum[j]=(d[i*4]*77+d[i*4+1]*150+d[i*4+2]*29)>>8;if(prevLum)diff+=Math.abs(lum[j]-prevLum[j]);}
    const motion=prevLum?diff/lum.length:99;prevLum=lum;
    let r;try{r=BelegDetect.detectData(d,w,h);}catch(e){r={found:false};}
    if(r.found&&(r.x1-r.x0)*(r.y1-r.y0)<.05)r.found=false;
    // Detection on a hand-held phone flickers from frame to frame: show and judge a smoothed frame,
    // and count the receipt as steady when most recent frames agree with it and the picture is calm.
    const raw=r.found?r:null;
    if(raw){
      if(!smooth||iou(raw,smooth)<.5){jumps++;if(!smooth||jumps>=2){smooth=Object.assign({},raw,{q:raw.q.map(p=>p.slice())});jumps=0;}}
      else{jumps=0;['x0','y0','x1','y1'].forEach(k=>smooth[k]+=.35*(raw[k]-smooth[k]));
        smooth.q.forEach((p,i)=>{p[0]+=.35*(raw.q[i][0]-p[0]);p[1]+=.35*(raw.q[i][1]-p[1]);});}
    }
    frames.push({t:t0,r:raw,motion});if(frames.length>5)frames.shift();
    const found=frames.filter(f=>f.r).length;
    if(found===0)smooth=null;
    live=smooth&&raw?smooth:(smooth&&found>=3?smooth:null);
    if(needMotion&&motion>12)needMotion=false;
    const agree=smooth?frames.filter(f=>f.r&&iou(f.r,smooth)>.75).length:0;
    const mm=frames.slice(-4).map(f=>f.motion).sort((a,b)=>a-b),med=mm[Math.floor(mm.length/2)],calm=med<22;
    const steady=!!live&&frames.length>=3&&agree>=3&&calm;
    if(dbgOn){const dt=frames.length>1?(frames[frames.length-1].t-frames[0].t)/(frames.length-1):0;
      $('dbg').textContent=(dt?Math.round(1000/dt):0)+' B/s · Bewegung '+med.toFixed(0)+(calm?' ruhig':' unruhig')+' · erkannt '+found+'/5 · passt '+agree+' · '+(raw?raw.mode:'-')+' · '+(auto?(needMotion?'wartet auf Bewegung':'scharf'):'Auto aus')+' · '+video.videoWidth+'×'+video.videoHeight;}
    if(steady){if(!stableSince)stableSince=t0;}else stableSince=0;
    const held=stableSince?t0-stableSince:0,need=600;
    const armed=auto&&!needMotion&&t0>=armAt;
    drawLive(armed?Math.min(1,held/need):0);
    hintLive(armed,held>0);
    if(armed&&held>=need){capture(true);return;}
  }
  loopT=setTimeout(loop,Math.max(30,140-(performance.now()-t0)));
}
function drawLive(p){
  octx.clearRect(0,0,innerWidth,innerHeight);
  $('ring').setAttribute('stroke-dashoffset',String(232.5*(1-p)));
  if(!live)return;
  const pts=live.q.map(([x,y])=>toScreen(x,y));
  octx.beginPath();pts.forEach(([x,y],i)=>i?octx.lineTo(x,y):octx.moveTo(x,y));octx.closePath();
  octx.fillStyle='rgba(255,195,0,'+(0.06+0.14*p)+')';octx.fill();
  octx.lineWidth=3;octx.strokeStyle='#FFC300';octx.lineJoin='round';octx.stroke();
}
function hintLive(armed,holding){
  const k=pieces.length,pre=k?'<span class="piece">Stück '+(k+1)+':</span> ':'';
  let msg;
  if(!live)msg=k?'Nächstes Stück so ins Bild, dass es etwas mit dem vorigen überlappt.':'Zettel ins Bild halten.';
  else if(!auto)msg='Zettel erkannt. Zum Aufnehmen auslösen.';
  else if(needMotion)msg='Für das nächste Foto die Kamera kurz bewegen, oder auslösen.';
  else msg=holding?'Ruhig halten …':'Zettel erkannt. Ruhig halten.';
  $('hint').innerHTML=pre+msg;
}
document.querySelector('.brand').addEventListener('click',()=>{if(++dbgTaps<3){setTimeout(()=>dbgTaps=0,1200);return;}dbgTaps=0;dbgOn=!dbgOn;store.set('dbg',dbgOn);$('dbg').hidden=!dbgOn;});
$('dbg').hidden=!dbgOn;
$('auto').addEventListener('click',()=>{auto=!auto;store.set('auto',auto);syncAuto();});
function syncAuto(){$('auto').classList.toggle('on',auto);$('auto').setAttribute('aria-pressed',String(auto));$('shutter').classList.toggle('auto',auto);}
syncAuto();
let torchOn=false;
$('torch').addEventListener('click',()=>{if(!track)return;torchOn=!torchOn;
  track.applyConstraints({advanced:[{torch:torchOn}]}).then(()=>{$('torch').classList.toggle('on',torchOn);$('torch').setAttribute('aria-pressed',String(torchOn));}).catch(()=>{torchOn=false;});});
$('shutter').addEventListener('click',()=>{if(running&&video.videoWidth)capture(false);else $('pick').click();});

function capture(isAuto){
  running=false;clearTimeout(loopT);
  const W=video.videoWidth,H=video.videoHeight,c=document.createElement('canvas');c.width=W;c.height=H;
  c.getContext('2d').drawImage(video,0,0,W,H);
  $('flash').classList.remove('on');void $('flash').offsetWidth;$('flash').classList.add('on');
  let r;try{r=BelegDetect.detect(c,W,H,480);}catch(e){r=null;}
  if(!r||!r.found)r=live?Object.assign({},live):{q:[[0,0],[1,0],[1,1],[0,1]],found:false};
  openReview(c,r,isAuto);
}
$('pick').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  const im=new Image(),u=URL.createObjectURL(f);
  im.onload=()=>{const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;c.getContext('2d').drawImage(im,0,0);URL.revokeObjectURL(u);
    let r;try{r=BelegDetect.detect(c,c.width,c.height,480);}catch(err){r={x0:0,y0:0,x1:1,y1:1,found:false};}
    running=false;clearTimeout(loopT);openReview(c,r,false);};
  im.onerror=()=>toast('Das Foto ließ sich nicht öffnen.');im.src=u;});

function backToCamera(){
  shot=null;screen('cam');handles.forEach(h=>h.remove());handles=[];showThumbs();
  needMotion=true;armAt=performance.now()+900;stableSince=0;frames=[];smooth=null;
  if(stream&&track&&track.readyState==='live'){running=true;loop();}else startCamera();
}
function showThumbs(){const t=$('thumbs');t.textContent='';
  pieces.slice(-3).forEach(c=>{const im=document.createElement('img');im.alt='';const s=document.createElement('canvas');s.width=60;s.height=Math.round(60*c.height/c.width);
    s.getContext('2d').drawImage(c,0,0,s.width,s.height);im.src=s.toDataURL('image/jpeg',.6);t.appendChild(im);});
  if(pieces.length){const b=document.createElement('span');b.textContent=pieces.length+'';b.style.cssText='font-size:13px;color:var(--accent);font-weight:500';t.appendChild(b);}
}

// ---------------------------------------------------------------- review and crop
const cv=$('cv'),ctx=cv.getContext('2d'),stage=$('stage');let handles=[],geo=null;
function openReview(c,r,isAuto){
  shot=c;quad=(r.q||[[0,0],[1,0],[1,1],[0,1]]).map(p=>p.slice());screen('review');
  const k=pieces.length;
  $('rnote').innerHTML=(k?'<b>Stück '+(k+1)+'</b> · ':'')+(r.found?'Ecken passen? Sonst die gelben Punkte ziehen. Der Zettel wird gerade gezogen.':'Kein Zettel erkannt. Zieh die gelben Punkte an die vier Ecken.');
  $('send').textContent=k?'Alle '+(k+1)+' Stücke senden':'Senden';
  makeHandles();requestAnimationFrame(drawReview);
}
function drawReview(){
  if(!shot)return;
  const sw=stage.clientWidth,sh=stage.clientHeight,s=Math.min(sw/shot.width,sh/shot.height),dw=Math.round(shot.width*s),dh=Math.round(shot.height*s);
  const dpr=Math.min(2,devicePixelRatio||1),ox=Math.round((sw-dw)/2),oy=Math.round((sh-dh)/2);geo={ox,oy,dw,dh};
  cv.style.left=ox+'px';cv.style.top=oy+'px';cv.style.width=dw+'px';cv.style.height=dh+'px';cv.width=Math.round(dw*dpr);cv.height=Math.round(dh*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.drawImage(shot,0,0,dw,dh);
  const pts=quad.map(([x,y])=>[x*dw,y*dh]);
  ctx.fillStyle='rgba(0,0,0,.62)';ctx.beginPath();ctx.rect(0,0,dw,dh);pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill('evenodd');
  ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.strokeStyle='#FFC300';ctx.lineWidth=2;ctx.stroke();
  handles.forEach((hd,i)=>{hd.style.left=(ox+pts[i][0])+'px';hd.style.top=(oy+pts[i][1])+'px';});
}
function makeHandles(){
  handles.forEach(h=>h.remove());handles=[];
  quad.forEach((_,i)=>{
    const h=document.createElement('div');h.className='handle';h.setAttribute('aria-label','Ecke verschieben');stage.appendChild(h);handles.push(h);
    h.addEventListener('pointerdown',e=>{e.preventDefault();h.setPointerCapture(e.pointerId);
      const move=ev=>{const cr=cv.getBoundingClientRect();
        quad[i]=[Math.min(1,Math.max(0,(ev.clientX-cr.left)/cr.width)),Math.min(1,Math.max(0,(ev.clientY-cr.top)/cr.height))];drawReview();};
      const up=()=>{h.removeEventListener('pointermove',move);h.removeEventListener('pointerup',up);h.removeEventListener('pointercancel',up);};
      h.addEventListener('pointermove',move);h.addEventListener('pointerup',up);h.addEventListener('pointercancel',up);});
  });
}
// homography that maps the output rectangle (0..w, 0..h) onto the four corners in the photo
function homography(w,h,q){
  const src=[[0,0],[w,0],[w,h],[0,h]],A=[],B=[];
  for(let i=0;i<4;i++){const [x,y]=src[i],[u,v]=q[i];
    A.push([x,y,1,0,0,0,-u*x,-u*y]);B.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);B.push(v);}
  for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;
    [A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];
    for(let r=0;r<8;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let k=c;k<8;k++)A[r][k]-=f*A[c][k];B[r]-=f*B[c];}}
  return B.map((b,i)=>b/A[i][i]);
}
// cut the receipt out along its corners and pull it straight (perspective), long side at most 3000 px
function cropShot(){
  const W=shot.width,H=shot.height,q=quad.map(([x,y])=>[x*W,y*H]);
  const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let ow=Math.max(d(q[0],q[1]),d(q[3],q[2])),oh=Math.max(d(q[0],q[3]),d(q[1],q[2]));
  const k=Math.min(1,3000/Math.max(ow,oh));ow=Math.max(8,Math.round(ow*k));oh=Math.max(8,Math.round(oh*k));
  const src=shot.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data;
  const c=document.createElement('canvas');c.width=ow;c.height=oh;const o=c.getContext('2d'),img=o.createImageData(ow,oh),out=img.data;
  const [a,b,cc,dd,e,f,g,hh]=homography(ow,oh,q);
  for(let y=0;y<oh;y++){const yc=y+.5;
    for(let x=0;x<ow;x++){const xc=x+.5,z=g*xc+hh*yc+1,u=(a*xc+b*yc+cc)/z-.5,v=(dd*xc+e*yc+f)/z-.5;
      const x0=Math.max(0,Math.min(W-2,Math.floor(u))),y0=Math.max(0,Math.min(H-2,Math.floor(v))),fx=Math.min(1,Math.max(0,u-x0)),fy=Math.min(1,Math.max(0,v-y0));
      const i00=(y0*W+x0)*4,i10=i00+4,i01=i00+W*4,i11=i01+4,j=(y*ow+x)*4;
      for(let ch=0;ch<3;ch++){const t=src[i00+ch]*(1-fx)+src[i10+ch]*fx,bt=src[i01+ch]*(1-fx)+src[i11+ch]*fx;out[j+ch]=t*(1-fy)+bt*fy;}
      out[j+3]=255;}}
  o.putImageData(img,0,0);return c;
}
$('again').addEventListener('click',backToCamera);
$('more').addEventListener('click',()=>{pieces.push(cropShot());backToCamera();});
$('send').addEventListener('click',async()=>{
  const all=pieces.concat([cropShot()]);pieces=[];
  let out=all[0],note='';
  if(all.length>1){
    busy('Stücke werden zusammengefügt …');
    try{const cvlib=(await loadOpenCV()).cv;const res=BelegStitch.joinPieces(cvlib,all);out=res.canvas;
      if(res.joined<res.seams)note=' (nicht alle Stücke überlappten, dort einfach untereinander gesetzt)';}
    catch(e){const res=BelegStitch.joinPieces(null,all);out=res.canvas;note=' (untereinander gesetzt)';}
    busy('');
  }
  const blob=await new Promise(r=>out.toBlob(r,'image/jpeg',.85));
  if(!blob){toast('Das Bild ließ sich nicht speichern. Bitte noch einmal.');backToCamera();return;}
  const name='Beleg_'+stamp(new Date())+'.jpg';
  const th=document.createElement('canvas');th.width=80;th.height=Math.round(80*out.height/out.width);th.getContext('2d').drawImage(out,0,0,th.width,th.height);
  const item={name,blob,created:Date.now(),w:out.width,h:out.height,n:all.length,kb:Math.round(blob.size/1024),thumb:th.toDataURL('image/jpeg',.6)};
  await Queue.add(item);addHistory(item,'wait');
  toast('Aufgenommen: '+(all.length>1?all.length+' Stücke, ':'')+item.kb+' KB'+note+'. Wird hochgeladen …');
  backToCamera();Sync.run();
});

let cvPromise=null;
function loadOpenCV(){
  if(cvPromise)return cvPromise;
  cvPromise=new Promise((res,rej)=>{
    const s=document.createElement('script');s.src='opencv.js';s.async=true;
    // the Emscripten module is itself a "thenable": resolve with a wrapper, never with the module
    s.onload=()=>{const c=window.cv;
      if(!c)return rej(new Error('cv'));
      if(c.Mat)return res({cv:c});
      if(typeof c.then==='function')return c.then(m=>{const k=m||c;if(k.Mat)res({cv:k});else k.onRuntimeInitialized=()=>res({cv:k});});
      c.onRuntimeInitialized=()=>res({cv:c});};
    s.onerror=()=>{cvPromise=null;rej(new Error('opencv laden'));};
    document.head.appendChild(s);setTimeout(()=>rej(new Error('timeout')),45000);});
  return cvPromise;
}

// ---------------------------------------------------------------- offline queue (IndexedDB)
const Queue=(()=>{
  let dbp=null;
  function open(){if(dbp)return dbp;dbp=new Promise((res,rej)=>{const r=indexedDB.open('beleg-kamera',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('queue',{keyPath:'name'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return dbp;}
  async function tx(mode,fn){const db=await open();return new Promise((res,rej)=>{const t=db.transaction('queue',mode),s=t.objectStore('queue');const out=fn(s);
    t.oncomplete=()=>res(out&&out.result!==undefined?out.result:undefined);t.onerror=()=>rej(t.error);});}
  return {add:i=>tx('readwrite',s=>s.put(i)),all:()=>tx('readonly',s=>s.getAll()),del:n=>tx('readwrite',s=>s.delete(n))};
})();

// ---------------------------------------------------------------- history (this phone only)
function addHistory(item,status){const h=store.get('verlauf',[]).filter(x=>x.name!==item.name);
  h.unshift({name:item.name,kb:item.kb,n:item.n,w:item.w,h:item.h,created:item.created,thumb:item.thumb,status});store.set('verlauf',h.slice(0,25));renderHistory();}
function setHistory(name,status,extra){const h=store.get('verlauf',[]);const x=h.find(v=>v.name===name);if(x){x.status=status;Object.assign(x,extra||{});store.set('verlauf',h);}renderHistory();}
function renderHistory(){
  const h=store.get('verlauf',[]),ul=$('list');ul.textContent='';$('empty').hidden=h.length>0;
  const waiting=h.filter(x=>x.status!=='done').length;
  $('hist').textContent=waiting?'Verlauf · '+waiting+' wartet':'Verlauf';$('hist').classList.toggle('warn',waiting>0);
  h.forEach(v=>{const li=document.createElement('li');li.className='item';
    const im=document.createElement('img');im.alt='';if(v.thumb)im.src=v.thumb;
    const mid=document.createElement('div');mid.style.minWidth='0';
    const nm=document.createElement('div');nm.className='name';nm.textContent=v.savedAs||v.name;
    const mt=document.createElement('div');mt.className='meta';mt.textContent=v.kb+' KB · '+v.w+'×'+v.h+(v.n>1?' · '+v.n+' Stücke':'');
    mid.append(nm,mt);const p=document.createElement('span');
    p.className='pill '+(v.status==='done'?'done':v.status==='fail'?'fail':'wait');p.textContent=v.status==='done'?'Im Eingang':v.status==='fail'?'Fehler':'Wartet';
    li.append(im,mid,p);ul.appendChild(li);});
}

// ---------------------------------------------------------------- Dropbox (OAuth PKCE, no server, no secret)
const Dropbox=(()=>{
  const b64u=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const standalone=()=>(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
  const redirectUri=()=>location.origin+location.pathname;
  const tok=()=>store.get('dbx',null);
  // The authorize link is prepared ahead of the tap: iOS only opens a new window straight from a tap,
  // and a home-screen app opens Dropbox in a separate browser sheet that does not share storage,
  // so Dropbox shows a code to paste back instead of redirecting.
  async function prepare(){
    let v=store.get('dbx_verifier','');if(!v){v=b64u(crypto.getRandomValues(new Uint8Array(48)));store.set('dbx_verifier',v);}
    const ch=b64u(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
    return 'https://www.dropbox.com/oauth2/authorize?'+new URLSearchParams({client_id:CFG.dropboxAppKey,response_type:'code',code_challenge:ch,code_challenge_method:'S256',token_access_type:'offline'});
  }
  async function exchange(code,withRedirect){
    const p=new URLSearchParams({code:code.trim(),grant_type:'authorization_code',client_id:CFG.dropboxAppKey,code_verifier:store.get('dbx_verifier','')});
    if(withRedirect)p.set('redirect_uri',redirectUri());
    const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:p});
    const j=await r.json().catch(()=>({}));if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||('HTTP '+r.status));
    store.set('dbx',{access:j.access_token,exp:Date.now()+(j.expires_in||14400)*1000,refresh:j.refresh_token,account:j.account_id});store.del('dbx_verifier');
  }
  async function access(force){
    const t=tok();if(!t)throw Object.assign(new Error('nicht verbunden'),{code:'auth'});
    if(!force&&t.exp-60000>Date.now())return t.access;
    if(!t.refresh)throw Object.assign(new Error('nicht verbunden'),{code:'auth'});
    const r=await fetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:t.refresh,client_id:CFG.dropboxAppKey})});
    const j=await r.json().catch(()=>({}));
    if(r.status===400||r.status===401){store.del('dbx');throw Object.assign(new Error('Verbindung abgelaufen'),{code:'auth'});}
    if(!r.ok||!j.access_token)throw new Error('token '+r.status);
    t.access=j.access_token;t.exp=Date.now()+(j.expires_in||14400)*1000;store.set('dbx',t);return t.access;
  }
  async function upload(name,blob){
    for(let attempt=0;attempt<2;attempt++){
      const a=await access(attempt>0);
      const r=await fetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{'Authorization':'Bearer '+a,'Content-Type':'application/octet-stream',
        'Dropbox-API-Arg':JSON.stringify({path:CFG.ziel.replace(/\/$/,'')+'/'+name,mode:'add',autorename:true,mute:false})},body:blob});
      if(r.status===401)continue;
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw Object.assign(new Error((j&&j.error_summary)||('HTTP '+r.status)),{status:r.status});
      return j;
    }
    throw Object.assign(new Error('nicht verbunden'),{code:'auth'});
  }
  return {prepare,exchange,upload,connected:()=>!!tok(),disconnect:()=>store.del('dbx'),standalone};
})();

const Sync=(()=>{
  let active=false,timer=0;
  async function run(){
    if(active)return;active=true;clearTimeout(timer);
    let left=0;
    try{
      const items=(await Queue.all()).sort((a,b)=>a.created-b.created);left=items.length;
      if(!items.length)return;
      if(!Dropbox.connected()){renderConn();return;}
      for(const it of items){
        try{const j=await Dropbox.upload(it.name,it.blob);await Queue.del(it.name);left--;
          setHistory(it.name,'done',{savedAs:j&&j.name&&j.name!==it.name?j.name:undefined});
          toast('Im Eingang: '+((j&&j.name)||it.name));}
        catch(e){
          if(e.code==='auth'){renderConn();toast('Dropbox ist nicht verbunden. Im Verlauf neu verbinden.',4500);break;}
          if(e.status>=400&&e.status<500&&e.status!==429){setHistory(it.name,'fail');toast('Hochladen abgelehnt: '+e.message,5000);break;}
          break; // offline or server busy: try again later
        }
      }
    }finally{active=false;if(left>0)timer=setTimeout(run,30000);}
  }
  addEventListener('online',run);document.addEventListener('visibilitychange',()=>{if(!document.hidden)run();});
  return {run};
})();

// ---------------------------------------------------------------- history sheet and connection
function renderConn(){
  const c=Dropbox.connected();
  $('connText').className=c?'ok':'';
  $('connText').textContent=!CFG.dropboxAppKey?'Der Dropbox-App-Schlüssel fehlt noch in config.js. Bis dahin bleiben Belege auf dem Handy in der Warteschlange.':
    c?'Verbunden. Belege landen direkt in '+CFG.ziel+'.':'Noch nicht verbunden. Aufnehmen geht trotzdem, die Belege warten auf dem Handy.';
  $('connect').hidden=c||!CFG.dropboxAppKey;$('disconnect').hidden=!c;
  $('codeBox').hidden=c||store.get('dbx_mode','')!=='code';
  if(!c&&CFG.dropboxAppKey)Dropbox.prepare().then(u=>{$('connect').href=u;}).catch(()=>{});
}
$('hist').addEventListener('click',()=>{stopLoopOnly();renderHistory();renderConn();screen('sheet');});
function stopLoopOnly(){running=false;clearTimeout(loopT);}
$('close').addEventListener('click',backToCamera);
$('connect').addEventListener('click',e=>{if(!$('connect').href){e.preventDefault();return;}store.set('dbx_mode','code');setTimeout(renderConn,300);});
$('codeOk').addEventListener('click',async()=>{const v=$('code').value;if(!v.trim())return;
  busy('Verbinde mit Dropbox …');try{await Dropbox.exchange(v,false);$('code').value='';toast('Dropbox verbunden.');Sync.run();}
  catch(e){toast('Das hat nicht geklappt: '+e.message+'. Bitte noch einmal verbinden.',5000);store.del('dbx_mode');}
  finally{busy('');renderConn();}});
$('disconnect').addEventListener('click',()=>{Dropbox.disconnect();renderConn();});
$('ziel').textContent=CFG.ziel;$('ver').textContent=VERSION;

// ---------------------------------------------------------------- start
(async function init(){
  renderHistory();
  const q=new URLSearchParams(location.search);
  if(q.get('code')&&store.get('dbx_verifier','')){
    window.history.replaceState(null,'',location.pathname);
    try{await Dropbox.exchange(q.get('code'),true);toast('Dropbox verbunden.');}catch(e){toast('Dropbox-Verbindung hat nicht geklappt: '+e.message,5000);}
  }else if(q.get('error')){window.history.replaceState(null,'',location.pathname);toast('Dropbox-Verbindung abgebrochen.');}
  if(!Dropbox.connected()&&CFG.dropboxAppKey&&!store.get('verlauf',[]).length){renderConn();screen('sheet');}
  else startCamera();
  Sync.run();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).catch(()=>{});
})();
})();
