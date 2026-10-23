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
  // four corners of a pixel set (TL, TR, BR, BL) from the extremes of x+y and x-y: follows a tilted
  // or keystoned receipt, which an upright box cannot
  function corners(test,x0,y0,x1,y1,w){
    let a=1e9,b=-1e9,c=-1e9,d=1e9,A,B,C,D;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(!test(y*w+x))continue;
      const s1=x+y,s2=x-y;if(s1<a){a=s1;A=[x,y];}if(s1>b){b=s1;C=[x,y];}if(s2>c){c=s2;B=[x+1,y];}if(s2<d){d=s2;D=[x,y+1];}}
    return A?[A,B,[C[0]+1,C[1]+1],D]:null;
  }
  function quadArea(q){let s=0;for(let i=0;i<4;i++){const [x1,y1]=q[i],[x2,y2]=q[(i+1)%4];s+=x1*y2-x2*y1;}return Math.abs(s)/2;}
  let lastInk=null,INK=14;
  function textBox(lum,w,h){
    // integral image for a 9x9 local mean; ink = clearly darker than its surroundings
    const I=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++){let r=0;for(let x=0;x<w;x++){r+=lum[y*w+x];I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+r;}}
    const ink=new Uint8Array(w*h),R=4;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=Math.max(0,x-R),b=Math.max(0,y-R),c=Math.min(w,x+R+1),d=Math.min(h,y+R+1);
      const mean=(I[d*(w+1)+c]-I[b*(w+1)+c]-I[d*(w+1)+a]+I[b*(w+1)+a])/((c-a)*(d-b));
      // 3x3 mean instead of the single pixel: sensor noise and fabric grain stop counting as print
      const a3=Math.max(0,x-1),b3=Math.max(0,y-1),c3=Math.min(w,x+2),d3=Math.min(h,y+2);
      const m3=(I[d3*(w+1)+c3]-I[b3*(w+1)+c3]-I[d3*(w+1)+a3]+I[b3*(w+1)+a3])/((c3-a3)*(d3-b3));
      ink[y*w+x]=(mean-m3)>INK?1:0;}
    lastInk=ink;
    let blk=morph(morph(ink,w,h,7,4,true),w,h,7,4,false);blk=morph(blk,w,h,2,2,true);
    const {comps}=label(blk,w,h);if(!comps.length)return null;
    // the block of print: big, densely inked (not a long table edge) and near the middle
    let b0=comps[0],bs=-1;
    for(const c of comps.slice(0,12)){let k=0;for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)k+=ink[y*w+x];
      const bw=c.x1-c.x0+1,bh=c.y1-c.y0+1,dens=k/(bw*bh),cx=(c.x0+c.x1)/2/w-.5,cy=(c.y0+c.y1)/2/h-.5;
      const sc=Math.sqrt(c.cnt)*Math.min(1,dens/.05)*(1-.7*Math.min(1,Math.hypot(cx*1.2,cy*.8)/.5))*(Math.min(bw,bh)<4?.2:1);
      if(sc>bs){bs=sc;b0=c;}}
    let x0=b0.x0,y0=b0.y0,x1=b0.x1,y1=b0.y1;
    for(const c of comps.slice(0,30)){if(c===b0)continue;if(c.cnt<b0.cnt*.02)break;
      const cw=c.x1-c.x0,ov=Math.min(x1,c.x1)-Math.max(x0,c.x0);
      if(ov>.5*cw&&cw<1.3*(x1-x0+1)){y0=Math.min(y0,c.y0);y1=Math.max(y1,c.y1);x0=Math.min(x0,c.x0);x1=Math.max(x1,c.x1);}}
    return [x0,y0,x1,y1];
  }
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

  // Candidates for "the receipt": bright paper regions at several thresholds, the block of print, and a
  // bright strip in the middle. Each is scored on how a receipt looks: compact, clearly brighter than
  // its surroundings, filled with print, near the middle. Tuned on Chris's photos Jun–Oct 2026
  // (white paper, wooden floor, grey table, car seat).
  function detectData(d,w,h,dbg){
    const n=w*h,lum=new Uint8Array(n),sat=new Uint8Array(n),wh=new Uint8Array(n);
    for(let i=0;i<n;i++){const r=d[i*4],g=d[i*4+1],b=d[i*4+2];lum[i]=Math.round(.299*r+.587*g+.114*b);sat[i]=Math.max(r,g,b)-Math.min(r,g,b);
      wh[i]=Math.max(0,lum[i]-(sat[i]>>1));}
    const tb=textBox(lum,w,h),ink=lastInk;
    const II=new Float64Array((w+1)*(h+1));
    for(let y=0;y<h;y++){let r=0;for(let x=0;x<w;x++){r+=ink[y*w+x];II[(y+1)*(w+1)+x+1]=II[y*(w+1)+x+1]+r;}}
    const inkIn=(x0,y0,x1,y1)=>{x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(w,x1+1);y1=Math.min(h,y1+1);
      return x1>x0&&y1>y0?(II[y1*(w+1)+x1]-II[y0*(w+1)+x1]-II[y1*(w+1)+x0]+II[y0*(w+1)+x0]):0;};
    const totalInk=inkIn(0,0,w-1,h-1)||1;
    const sorted=Array.from(wh).sort((a,b)=>a-b),pct=p=>sorted[Math.min(n-1,Math.floor(n*p/100))];
    const cands=[];
    const centre=bb=>{const cx=(bb[0]+bb[2])/2/w-.5,cy=(bb[1]+bb[3])/2/h-.5;return 1-.7*Math.min(1,Math.hypot(cx*1.2,cy*.8)/.5);};
    const judge=(bb,fill,kind,q)=>{
      const bw=bb[2]-bb[0]+1,bh=bb[3]-bb[1]+1,area=bw*bh/n;if(area<.02||area>.85)return;
      const rw=Math.max(3,Math.round(.025*Math.max(w,h)));let si=0,ni=0,so=0,no=0;
      for(let y=Math.max(0,bb[1]-rw);y<=Math.min(h-1,bb[3]+rw);y+=1)for(let x=Math.max(0,bb[0]-rw);x<=Math.min(w-1,bb[2]+rw);x+=1){
        const inside=x>=bb[0]&&x<=bb[2]&&y>=bb[1]&&y<=bb[3];if(inside){si+=lum[y*w+x];ni++;}else{so+=lum[y*w+x];no++;}}
      const contrast=no>20?si/ni-so/no:40;
      const inkHere=inkIn(bb[0],bb[1],bb[2],bb[3]),dens=inkHere/(bw*bh),share=inkHere/totalInk;
      const side=(bb[0]<=1)+(bb[2]>=w-2);
      const C=Math.min(1,Math.max(0,(contrast-15)/40)),ctr=centre(bb);
      let sc;
      if(kind==='text')sc=.55*ctr*Math.min(1,dens/.04)*Math.min(1,share/.4);
      else sc=fill*fill*C*ctr*(side?.6:1)*(area>.6?.5:1)*(dens>.015?1:.4);
      cands.push({bb,q,kind,sc,fill,contrast,dens,share,area});};
    for(const p of [55,65,75,82,88,93,96]){const t=Math.max(60,pct(p));
      let m=new Uint8Array(n);for(let i=0;i<n;i++)m[i]=wh[i]>t?1:0;
      m=morph(morph(m,w,h,1,1,false),w,h,1,1,true);
      const {lab,comps}=label(m,w,h);
      for(const c of comps.slice(0,4)){if(c.cnt<.015*n)break;
        const L=i=>lab[i]===c.id,bb=[c.x0,c.y0,c.x1,c.y1];
        const fc=x=>{let k=0,t2=0;for(let y=bb[1];y<=bb[3];y++){t2++;if(L(y*w+x))k++;}return k/t2;};
        const fr=y=>{let k=0,t2=0;for(let x=bb[0];x<=bb[2];x++){t2++;if(L(y*w+x))k++;}return k/t2;};
        while(bb[2]-bb[0]>10&&fc(bb[0])<.45)bb[0]++;while(bb[2]-bb[0]>10&&fc(bb[2])<.45)bb[2]--;
        while(bb[3]-bb[1]>10&&fr(bb[1])<.45)bb[1]++;while(bb[3]-bb[1]>10&&fr(bb[3])<.45)bb[3]--;
        let k=0;for(let y=bb[1];y<=bb[3];y++)for(let x=bb[0];x<=bb[2];x++)if(L(y*w+x))k++;
        // print is dark, so count it as paper when it sits inside the region
        const fill=Math.min(1,(k+inkIn(bb[0],bb[1],bb[2],bb[3]))/((bb[2]-bb[0]+1)*(bb[3]-bb[1]+1)));
        const q=corners(L,c.x0,c.y0,c.x1,c.y1,w),qa=q?quadArea(q):0;
        // a tilted receipt: the corners describe it well, so keep its full extent instead of the trimmed box
        if(q&&qa>0&&(c.cnt+inkIn(c.x0,c.y0,c.x1,c.y1))/qa>=.85&&qa<.97*(c.x1-c.x0+1)*(c.y1-c.y0+1))
          judge([c.x0,c.y0,c.x1,c.y1],Math.min(1,(c.cnt+inkIn(c.x0,c.y0,c.x1,c.y1))/qa),'papier',q);
        else judge(bb,fill,'papier',q&&qa>=.85*(bb[2]-bb[0]+1)*(bb[3]-bb[1]+1)?q:null);}}
    if(tb){const mx=Math.round(.03*w),my=Math.round(.02*h);judge([Math.max(0,tb[0]-mx),Math.max(0,tb[1]-my),Math.min(w-1,tb[2]+mx),Math.min(h-1,tb[3]+my)],.95,'text',null);}
    const ts=[otsu(lum),...[70,80,88].map(p=>Array.from(lum).sort((a,b)=>a-b)[Math.floor(n*p/100)])];
    for(const t of ts){const p=projBox(lum,sat,Math.max(110,t),w,h);if(p)judge(p.bb,p.fill,'streifen',null);}
    cands.sort((a,b)=>b.sc-a.sc);if(dbg)dbg.push(...cands.slice(0,6));
    // a clearly outlined paper wins outright: its edge is exact, the print block may catch grain or creases
    const strong=cands.find(c=>c.kind!=='text'&&c.sc>=.35);
    const best=strong||cands[0];
    if(!best||best.sc<.08)return {x0:0,y0:0,x1:1,y1:1,found:false,mode:'keiner',q:[[0,0],[1,0],[1,1],[0,1]]};
    const bb=best.bb,m=best.kind==='text'?.02:.012;
    const r={x0:Math.max(0,bb[0]/w-m),y0:Math.max(0,bb[1]/h-m),x1:Math.min(1,(bb[2]+1)/w+m),y1:Math.min(1,(bb[3]+1)/h+m),found:true,mode:best.kind,score:best.sc};
    let q=best.q||[[bb[0],bb[1]],[bb[2]+1,bb[1]],[bb[2]+1,bb[3]+1],[bb[0],bb[3]+1]];
    const cx=(q[0][0]+q[1][0]+q[2][0]+q[3][0])/4,cy=(q[0][1]+q[1][1]+q[2][1]+q[3][1])/4;
    r.q=q.map(([x,y])=>[Math.min(1,Math.max(0,(x+Math.sign(x-cx)*m*w)/w)),Math.min(1,Math.max(0,(y+Math.sign(y-cy)*m*h)/h))]);
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
