// Joins receipt pieces taken top to bottom. Each later piece is aligned onto the
// result so far with ORB features + RANSAC affine, then cut at a blank text line.
// a, b: {data:Uint8ClampedArray RGBA, width, height}. Returns {M,inliers} mapping b -> a, or null.
function matchPieces(cv,a,b){
  const ma=cv.matFromImageData(a),mb=cv.matFromImageData(b);
  const ga=new cv.Mat(),gb=new cv.Mat();cv.cvtColor(ma,ga,cv.COLOR_RGBA2GRAY);cv.cvtColor(mb,gb,cv.COLOR_RGBA2GRAY);
  // only the bottom 60 % of a and the top 70 % of b can overlap
  const maskA=cv.Mat.zeros(ga.rows,ga.cols,cv.CV_8U),maskB=cv.Mat.zeros(gb.rows,gb.cols,cv.CV_8U);
  maskA.roi(new cv.Rect(0,Math.floor(ga.rows*.4),ga.cols,ga.rows-Math.floor(ga.rows*.4))).setTo(new cv.Scalar(255));
  maskB.roi(new cv.Rect(0,0,gb.cols,Math.floor(gb.rows*.7))).setTo(new cv.Scalar(255));
  const orb=new cv.ORB(5000),ka=new cv.KeyPointVector(),kb=new cv.KeyPointVector(),da=new cv.Mat(),db=new cv.Mat();
  orb.detectAndCompute(ga,maskA,ka,da);orb.detectAndCompute(gb,maskB,kb,db);
  let res=null;
  if(da.rows>10&&db.rows>10){
    const bf=new cv.BFMatcher(cv.NORM_HAMMING,false),mm=new cv.DMatchVectorVector();bf.knnMatch(db,da,mm,2);
    const src=[],dst=[];
    for(let i=0;i<mm.size();i++){const m=mm.get(i);if(m.size()<2)continue;const m0=m.get(0),m1=m.get(1);
      if(m0.distance<.75*m1.distance){const p=kb.get(m0.queryIdx).pt,q=ka.get(m0.trainIdx).pt;src.push(p.x,p.y);dst.push(q.x,q.y);}}
    mm.delete();bf.delete();
    if(src.length/2>=12){
      const s=cv.matFromArray(src.length/2,1,cv.CV_32FC2,src),d=cv.matFromArray(dst.length/2,1,cv.CV_32FC2,dst),inl=new cv.Mat();
      const M=cv.estimateAffine2D(s,d,inl,cv.RANSAC,4);
      let n=0;for(let i=0;i<inl.rows;i++)n+=inl.data[i];
      if(M.rows===2){const m=Array.from(M.data64F);
        const sc=Math.hypot(m[0],m[3]),sk=Math.abs(Math.hypot(m[1],m[4])-sc);
        if(n>=25&&sc>.6&&sc<1.6&&sk<.08)res={M:m,inliers:n};}
      M.delete();s.delete();d.delete();inl.delete();
    }
  }
  [ma,mb,ga,gb,maskA,maskB,da,db].forEach(x=>x.delete());ka.delete();kb.delete();orb.delete();
  return res;
}

// affine maps as [a,b,c,d,e,f]: x'=a*x+b*y+c, y'=d*x+e*y+f
function mul(P,Q){return [P[0]*Q[0]+P[1]*Q[3],P[0]*Q[1]+P[1]*Q[4],P[0]*Q[2]+P[1]*Q[5]+P[2],
  P[3]*Q[0]+P[4]*Q[3],P[3]*Q[1]+P[4]*Q[4],P[3]*Q[2]+P[4]*Q[5]+P[5]];}
function ys(T,w,h,top){const a=top?0:h;return [T[3]*0+T[4]*a+T[5],T[3]*w+T[4]*a+T[5]];}
function px(c){return c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height);}
function inkRows(c,lo,hi){const {data,width}=px(c),x0=Math.floor(width*.1),x1=Math.floor(width*.9),v=[];
  for(let y=lo;y<hi;y++){let k=0;for(let x=x0;x<x1;x+=2){const i=(y*width+x)*4;if(.299*data[i]+.587*data[i+1]+.114*data[i+2]<120)k++;}v.push(k);}return v;}
function draw(o,c,T){o.save();o.transform(T[0],T[3],T[1],T[4],T[2],T[5]);o.drawImage(c,0,0);o.restore();}

// pieces: canvases, top to bottom, each already cropped to the receipt. All pieces keep one common
// scale (the matcher works out how far the phone moved between them).
// Returns {canvas, joined: how many seams were aligned by features, seams}.
function joinPieces(cv,pieces){
  const k0=Math.min(1,1200/Math.max(...pieces.map(p=>p.width)));
  const scaled=pieces.map(p=>{const c=document.createElement('canvas');
    c.width=Math.round(p.width*k0);c.height=Math.round(p.height*k0);c.getContext('2d').drawImage(p,0,0,c.width,c.height);return c;});
  const T=[[1,0,0,0,1,0]],cuts=[0];let joined=0;
  for(let i=1;i<scaled.length;i++){
    const prev=scaled[i-1],cur=scaled[i];
    let M=null;try{const r=cv?matchPieces(cv,px(prev),px(cur)):null;if(r)M=r.M;}catch(e){M=null;}
    const pb=Math.max(...ys(T[i-1],prev.width,prev.height,false));
    if(M){joined++;T.push(mul(T[i-1],M));}
    else T.push([1,0,T[i-1][2],0,1,pb+12]);
    const ct=Math.min(...ys(T[i],cur.width,cur.height,true));
    let lo=Math.ceil(ct+30),hi=Math.floor(pb-30),cut;
    if(!M)cut=Math.round(pb+6);
    else if(hi-lo<10)cut=Math.round((ct+pb)/2);
    else{ // a row without print in both pictures, so no text line is cut in half
      const W=Math.ceil(Math.max(prev.width*1.6,cur.width*1.6)),ox=Math.round(W*.2);
      const a=document.createElement('canvas'),b=document.createElement('canvas');[a,b].forEach(k=>{k.width=W;k.height=hi-lo;});
      const ta=T[i-1].slice(),tb=T[i].slice();ta[5]-=lo;tb[5]-=lo;ta[2]+=ox-T[i-1][2];tb[2]+=ox-T[i-1][2];
      const oa=a.getContext('2d'),ob=b.getContext('2d');oa.fillStyle=ob.fillStyle='#fff';oa.fillRect(0,0,W,hi-lo);ob.fillRect(0,0,W,hi-lo);
      draw(oa,prev,ta);draw(ob,cur,tb);
      const va=inkRows(a,0,hi-lo),vb=inkRows(b,0,hi-lo);let best=0,bv=1e9;
      for(let y=0;y<va.length;y++){let s=0;for(let k=-5;k<=5;k++){const j=Math.min(va.length-1,Math.max(0,y+k));s+=va[j]+vb[j];}
        if(s<bv){bv=s;best=y;}}
      cut=lo+best;}
    cuts.push(cut);
  }
  // bounding box of all placed pieces
  let x0=1e9,x1=-1e9,y1=-1e9;
  scaled.forEach((c,i)=>{const t=T[i];[[0,0],[c.width,0],[0,c.height],[c.width,c.height]].forEach(([x,y])=>{
    const X=t[0]*x+t[1]*y+t[2],Y=t[3]*x+t[4]*y+t[5];x0=Math.min(x0,X);x1=Math.max(x1,X);y1=Math.max(y1,Y);});});
  const last=scaled.length-1,W=Math.ceil(x1-x0),H=Math.ceil(y1);
  const k=Math.min(1,12000/H,1600/W),out=document.createElement('canvas');out.width=Math.round(W*k);out.height=Math.round(H*k);
  const o=out.getContext('2d');o.fillStyle='#fff';o.fillRect(0,0,out.width,out.height);o.scale(k,k);o.translate(-x0,0);
  scaled.forEach((c,i)=>{const ya=cuts[i],yb=i<last?cuts[i+1]:H;o.save();o.beginPath();o.rect(x0,ya,W,yb-ya);o.clip();draw(o,c,T[i]);o.restore();});
  return {canvas:out,joined,seams:last};
}
if(typeof window!=='undefined')window.BelegStitch={joinPieces,matchPieces};
