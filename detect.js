// Receipt detection on a small copy of a picture. Tuned on Chris's receipt photos (June–October 2026):
// (a) a clean bright paper region on a darker ground, otherwise (b) the block of printed text,
// and (c) for cluttered tables a bright vertical strip in the middle of the picture.
(function(root){
  function morph(m,w,h,rx,ry,isMax){
    const t=new Uint8Array(m.length),o=new Uint8Array(m.length);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;
      for(let k=-rx;k<=rx;k++){const xx=x+k;const b=(xx<0||xx>=w)?(isMax?0:1):m[y*w+xx];if(isMax?b:!b){v=isMax?1:0;break;}}t[y*w+x]=v;}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=isMax?0:1;
      for(let k=-ry;k<=ry;k++){const yy=y+k;const b=(yy<0||yy>=h)?(isMax?0:1):t[yy*w+x];if(isMax?b:!b){v=isMax?1:0;break;}}o[y*w+x]=v;}
    return o;
  }
  function label(m,w,h){
    const n=w*h,lab=new Int32Array(n),q=new Int32Array(n),comps=[];let id=0;
    for(let i=0;i<n;i++){if(!m[i]||lab[i])continue;id++;let qh=0,qt=0;q[qt++]=i;lab[i]=id;
      let cnt=0,x0=w,y0=h,x1=0,y1=0;
      while(qh<qt){const p=q[qh++],px=p%w,py=(p-px)/w;cnt++;
        if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;
        if(px>0&&m[p-1]&&!lab[p-1]){lab[p-1]=id;q[qt++]=p-1;}
        if(px<w-1&&m[p+1]&&!lab[p+1]){lab[p+1]=id;q[qt++]=p+1;}
        if(py>0&&m[p-w]&&!lab[p-w]){lab[p-w]=id;q[qt++]=p-w;}
        if(py<h-1&&m[p+w]&&!lab[p+w]){lab[p+w]=id;q[qt++]=p+w;}}
      comps.push({id,cnt,x0,y0,x1,y1});}
    comps.sort((a,b)=>b.cnt-a.cnt);return {lab,comps};
  }
  function otsu(lum){const hist=new Array(256).fill(0);for(const v of lum)hist[v]++;const n=lum.length;
    let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sB=0,wB=0,best=0,t=150;
    for(let i=0;i<256;i++){wB+=hist[i];if(!wB)continue;const wF=n-wB;if(!wF)break;sB+=i*hist[i];
      const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>best){best=v;t=i;}}return t;}
  function paperCand(lum,sat,t,w,h){
    const n=w*h,m=new Uint8Array(n);for(let i=0;i<n;i++)m[i]=(lum[i]>t&&sat[i]<70)?1:0;
    const {lab,comps}=label(morph(m,w,h,1,1,true),w,h);if(!comps.length)return null;
    const c=comps[0],L=i=>lab[i]===c.id,bb=[c.x0,c.y0,c.x1,c.y1];
    const fc=x=>{let k=0,t2=0;for(let y=bb[1];y<=bb[3];y++){t2++;if(L(y*w+x))k++;}return k/t2;};
    const fr=y=>{let k=0,t2=0;for(let x=bb[0];x<=bb[2];x++){t2++;if(L(y*w+x))k++;}return k/t2;};
    while(bb[2]-bb[0]>10&&fc(bb[0])<.45)bb[0]++;while(bb[2]-bb[0]>10&&fc(bb[2])<.45)bb[2]--;
    while(bb[3]-bb[1]>10&&fr(bb[1])<.45)bb[1]++;while(bb[3]-bb[1]>10&&fr(bb[3])<.45)bb[3]--;
    const bw=bb[2]-bb[0]+1,bh=bb[3]-bb[1]+1,area=bw*bh/n;if(area<.03)return null;
    let k=0;for(let y=bb[1];y<=bb[3];y++)for(let x=bb[0];x<=bb[2];x++)if(L(y*w+x))k++;
    const fill=k/(bw*bh),touch=(bb[0]<=1)+(bb[1]<=1)+(bb[2]>=w-2)+(bb[3]>=h-2);
    return {bb,area,fill,touch,score:fill*(1-.25*touch)*(area>.85?.3:1)};
  }
  function textBox(lum,w,h){
    // integral image for a 9x9 local mean; ink = clearly darker than its surroundings
    const I=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++){let r=0;for(let x=0;x<w;x++){r+=lum[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+r;}}
    const ink=new Uint8Array(w*h),R=4;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=Math.max(0,x-R),b=Math.max(0,y-R),c=Math.min(w,x+R+1),d=Math.min(h,y+R+1);
      const mean=(I[d*(w+1)+c]-I[b*(w+1)+c]-I[d*(w+1)+a]+I[b*(w+1)+a])/((c-a)*(d-b));ink[y*w+x]=(mean-lum[y*w+x])>22?1:0;}
    let blk=morph(morph(ink,w,h,7,4,true),w,h,7,4,false);blk=morph(blk,w,h,2,2,true);
    const {comps}=label(blk,w,h);if(!comps.length)return null;
    const b0=comps[0];let x0=b0.x0,y0=b0.y0,x1=b0.x1,y1=b0.y1;
    for(const c of comps.slice(1,30)){if(c.cnt<b0.cnt*.02)break;
      const cw=c.x1-c.x0,ov=Math.min(x1,c.x1)-Math.max(x0,c.x0);
      if(ov>.5*cw&&cw<1.3*(x1-x0+1)){y0=Math.min(y0,c.y0);y1=Math.max(y1,c.y1);x0=Math.min(x0,c.x0);x1=Math.max(x1,c.x1);}}
    return [x0,y0,x1,y1];
  }
  // (c) bright vertical strip at the centre of the picture: for cluttered tables where the
  // receipt touches other papers. The receipt is the one Chris aims at.
  function projBox(lum,sat,t,w,h){
    const n=w*h;let m=new Uint8Array(n);for(let i=0;i<n;i++)m[i]=(lum[i]>t&&sat[i]<70)?1:0;
    m=morph(morph(m,w,h,1,3,true),w,h,1,3,false);
    const col=new Float64Array(w);for(let x=0;x<w;x++){let k=0;for(let y=0;y<h;y++)k+=m[y*w+x];col[x]=k/h;}
    let c0=Math.floor(.35*w);for(let x=c0;x<Math.floor(.65*w);x++)if(col[x]>col[c0])c0=x;
    if(col[c0]<.45)return null;
    const thr=Math.max(.3,.6*col[c0]);let x0=c0,x1=c0;
    while(x0>0&&col[x0-1]>=thr)x0--;while(x1<w-1&&col[x1+1]>=thr)x1++;
    const row=new Float64Array(h);for(let y=0;y<h;y++){let k=0;for(let x=x0;x<=x1;x++)k+=m[y*w+x];row[y]=k/(x1-x0+1);}
    let r0=Math.floor(.3*h);for(let y=r0;y<Math.floor(.7*h);y++)if(row[y]>row[r0])r0=y;
    if(row[r0]<.6)return null;
    const gap=Math.floor(.06*h);
    const ext=(y,step)=>{let g=0,last=y;while(y+step>=0&&y+step<h){y+=step;if(row[y]>=.5){last=y;g=0;}else if(++g>gap)break;}return last;};
    const y0=ext(r0,-1),y1=ext(r0,1),bw=(x1-x0+1)/w,bh=(y1-y0+1)/h;
    if(!(bw>=.06&&bw<=.75&&bh>=.5))return null;
    let k=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)k+=m[y*w+x];
    return {bb:[x0,y0,x1,y1],fill:k/((x1-x0+1)*(y1-y0+1))};
  }
  // d: RGBA pixels of a w×h picture (already small, about 320–480 px on the long side).
  // Returns the receipt as fractions of the picture {x0,y0,x1,y1,found}.
  function detectData(d,w,h){
    const n=w*h,lum=new Uint8Array(n),sat=new Uint8Array(n);
    for(let i=0;i<n;i++){const r=d[i*4],g=d[i*4+1],b=d[i*4+2];lum[i]=Math.round(.299*r+.587*g+.114*b);sat[i]=Math.max(r,g,b)-Math.min(r,g,b);}
    const sorted=Array.from(lum).sort((a,b)=>a-b),pct=p=>sorted[Math.min(n-1,Math.floor(n*p/100))];
    const ts=new Set([Math.max(110,otsu(lum))]);[60,70,80,88].forEach(p=>ts.add(Math.max(110,pct(p))));
    let best=null;for(const t of ts){const cd=paperCand(lum,sat,t,w,h);if(cd&&(!best||cd.score>best.score))best=cd;}
    let bb,m,mode;
    if(best&&best.fill>=.9&&best.touch===0&&best.area<=.5){bb=best.bb;m=.01;mode='papier';}
    else{bb=textBox(lum,w,h);m=.04;mode='text';
      const ta=bb?(bb[2]-bb[0]+1)*(bb[3]-bb[1]+1)/n:1;
      if(ta>.55){let pb=null;for(const t of ts){const p=projBox(lum,sat,t,w,h);if(p&&(!pb||p.fill>pb.fill))pb=p;}
        if(pb&&pb.fill>=.75){bb=pb.bb;m=.015;mode='streifen';}}
      if(!bb)return {x0:0,y0:0,x1:1,y1:1,found:false,mode:'keiner'};}
    const r={x0:Math.max(0,bb[0]/w-m),y0:Math.max(0,bb[1]/h-m),x1:Math.min(1,(bb[2]+1)/w+m),y1:Math.min(1,(bb[3]+1)/h+m),found:true,mode};
    if((r.x1-r.x0)*(r.y1-r.y0)>.92||(r.x1-r.x0)*(r.y1-r.y0)<.02)r.found=false;
    return r;
  }
  // src: image, video or canvas; W,H its pixel size
  function detect(src,W,H,maxSide){
    const s=Math.min(1,(maxSide||480)/Math.max(W,H));
    const w=Math.max(1,Math.round(W*s)),h=Math.max(1,Math.round(H*s));
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,w,h);
    return detectData(x.getImageData(0,0,w,h).data,w,h);
  }
  root.BelegDetect={detect,detectData};
})(typeof window!=='undefined'?window:globalThis);
