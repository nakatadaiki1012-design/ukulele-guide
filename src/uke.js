/* =========================================================
   ウクレレの3Dモデル（コンサートサイズ・実寸）
   ========================================================= */
import * as THREE from 'three';
import { Q } from './quality.js';
import { fretX, slotCenter, halfW, strY, STRING_R, stringZ, FRET_TOP, NECK_DEPTH,
         BODY_X0, BODY_LEN, BODY_DEPTH, FB_END, HEAD_LEN, NUM_FRETS, SCALE_LEN } from './geom.js';

/* ---------- 木目テクスチャ（その場で描く） ---------- */
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
function woodTexture({base, dark, light, w=1024, h=256, lines=140, wave=6, seed=1, figure=0}){
  // 軽さの設定：絵のキャンバスだけ小さくする（描く座標はそのまま）
  const c = document.createElement('canvas'); c.width = Math.round(w*Q.tex); c.height = Math.max(16, Math.round(h*Q.tex));
  const g = c.getContext('2d'), r = rng(seed); g.scale(c.width/w, c.height/h);
  g.fillStyle = base; g.fillRect(0,0,w,h);
  for(let i=0;i<lines;i++){
    const y0 = r()*h, amp = 1+r()*wave, ph = r()*6.28, f = 0.5+r()*2;
    g.strokeStyle = r()<0.55 ? dark : light;
    g.globalAlpha = 0.05 + r()*0.22;
    g.lineWidth = 0.6 + r()*2.6;
    g.beginPath();
    for(let x=0;x<=w;x+=8){ const y = y0 + Math.sin(x/w*6.28*f+ph)*amp + Math.sin(x/w*40+ph*3)*amp*0.15; x?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
  }
  if(figure){ // 杢（光の帯）
    for(let i=0;i<figure;i++){ const x=r()*w; const gr=g.createLinearGradient(x-20,0,x+20,0);
      gr.addColorStop(0,'rgba(255,255,255,0)'); gr.addColorStop(.5,'rgba(255,230,200,.07)'); gr.addColorStop(1,'rgba(255,255,255,0)');
      g.globalAlpha=1; g.fillStyle=gr; g.fillRect(x-20,0,40,h); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/* ---------- ボディの輪郭 ---------- */
export function bodyOutline(){
  const x0 = BODY_X0, x1 = BODY_X0 + BODY_LEN;      // 210 → 491
  // 上半分の制御点 (x, 半幅)：アッパー152 / ウエスト125 / ロワー210
  const half = [[x0,0],[x0+2.5,28],[x0+11,52],[x0+28,69],[x0+62,76],[x0+92,70],[x0+108,62.5],
                [x0+124,66],[x0+150,88],[x0+176,103],[x0+196,105],[x0+222,99],[x0+246,82],[x0+266,55],[x0+277,28],[x1,0]];
  const pts = half.map(([x,y])=>new THREE.Vector3(x,y,0));
  for(let i=half.length-2;i>0;i--) pts.push(new THREE.Vector3(half[i][0], -half[i][1], 0));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return curve.getSpacedPoints(240).slice(0,-1).map(v=>new THREE.Vector2(v.x, v.y));
}
function insetPath(p, d){
  const n = p.length, out = [];
  for(let i=0;i<n;i++){
    const a = p[(i-1+n)%n], b = p[(i+1)%n];
    const tx = b.x-a.x, ty = b.y-a.y, l = Math.hypot(tx,ty)||1;
    // 反時計回りの輪郭なら、内側は (-ty, tx) の向き（d がマイナスなら外側）
    out.push(new THREE.Vector2(p[i].x - ty/l*d, p[i].y + tx/l*d));
  }
  return out;
}
function signedArea(p){ let s=0; for(let i=0;i<p.length;i++){ const a=p[i], b=p[(i+1)%p.length]; s+=a.x*b.y-b.x*a.y; } return s/2; }

/* ---------- 弦（細い円柱をつないで作る） ---------- */
const UNIT_CYL = new THREE.CylinderGeometry(1,1,1,8,1,false);
function placeSeg(mesh, a, b, r){
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
  const d = Bv.clone().sub(A), len = d.length();
  mesh.position.copy(A).addScaledVector(d, 0.5);
  mesh.scale.set(r, len, r);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize());
  mesh.visible = true;
}

export const TUNER_POS = [[-40,-18.5],[-82,-18.5],[-82,18.5],[-40,18.5]];  // G C E A

/* ウクレレの柄（ボディの木・塗装）。設定ボタンから選ぶ */
export const FINISHES = {
  mahogany: {label:'マホガニー',
    top: {base:'#6b3518', dark:'#3a1a0a', light:'#8a4a24', lines:160, wave:5, seed:3, figure:10},
    side:{base:'#5e2e14', dark:'#331607', light:'#7a3e1d', lines:140, wave:3, seed:9}, rough:0.42},
  koa: {label:'ハワイアンコア',                       // 金色がかった赤茶に、ゆらめく杢（もく）
    top: {base:'#9c5520', dark:'#552608', light:'#d68d43', lines:200, wave:10, seed:21, figure:46},
    side:{base:'#8a4a1c', dark:'#4a2208', light:'#c27a38', lines:170, wave:8, seed:23, figure:30}, rough:0.28},
  spruce: {label:'スプルース',                        // 表板だけ明るい白木、横と裏はマホガニー
    top: {base:'#e0c18a', dark:'#b89058', light:'#f5e0b4', lines:110, wave:1.5, seed:7, figure:3},
    side:{base:'#5e2e14', dark:'#331607', light:'#7a3e1d', lines:140, wave:3, seed:9},
    back:{base:'#6b3518', dark:'#3a1a0a', light:'#8a4a24', lines:160, wave:5, seed:3, figure:10}, rough:0.38},
  black: {label:'ブラック', paint:'#161314', rough:0.16},
  pastel: {label:'パステル', paint:'#8fd3cb', rough:0.3},
};

export function buildUkulele(){
  const g = new THREE.Group();
  const mahogany = new THREE.MeshStandardMaterial({map: woodTexture({base:'#6b3518', dark:'#3a1a0a', light:'#8a4a24', lines:160, wave:5, seed:3, figure:10}), roughness:0.42, metalness:0});
  const mahoganySide = new THREE.MeshStandardMaterial({map: woodTexture({base:'#5e2e14', dark:'#331607', light:'#7a3e1d', lines:140, wave:3, seed:9}), roughness:0.45});
  const rosewood = new THREE.MeshStandardMaterial({map: woodTexture({base:'#2a1810', dark:'#120905', light:'#3d2416', lines:200, wave:2, seed:5, w:2048, h:128}), roughness:0.6});
  const headWood = new THREE.MeshStandardMaterial({map: woodTexture({base:'#2c170c', dark:'#150904', light:'#40220f', lines:120, wave:3, seed:11}), roughness:0.4});
  const binding = new THREE.MeshStandardMaterial({color:'#e9dfc8', roughness:0.35});
  const bone = new THREE.MeshStandardMaterial({color:'#efe6cf', roughness:0.38});
  const fretMetal = new THREE.MeshStandardMaterial({color:'#d9d5cd', metalness:1, roughness:0.22});
  const chrome = new THREE.MeshStandardMaterial({color:'#e8e8ea', metalness:1, roughness:0.15});
  const pearl = new THREE.MeshStandardMaterial({color:'#efeae0', roughness:0.25});
  const stringMat = new THREE.MeshStandardMaterial({color:'#f3efe4', roughness:0.32});
  const dark = new THREE.MeshBasicMaterial({color:'#0b0603'});
  const add = (geo, mat, f) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; f && f(m); g.add(m); return m; };

  /* ボディ */
  let outline = bodyOutline();
  if(signedArea(outline) < 0) outline.reverse();
  const shapeOf = (pts, holes=[]) => { const s = new THREE.Shape(pts); holes.forEach(h=>s.holes.push(new THREE.Path(h))); return s; };
  const SH_X = BODY_X0 + 78, SH_R = 26;            // サウンドホール（直径52mm）
  const holePts = []; for(let i=0;i<64;i++){ const a=-i/64*Math.PI*2; holePts.push(new THREE.Vector2(SH_X+Math.cos(a)*SH_R, Math.sin(a)*SH_R)); }
  const uvScale = (geo, sx, sy) => { const uv = geo.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*sx, uv.getY(i)*sy); return geo; };
  const plate = 2.5;
  const topGeo = uvScale(new THREE.ExtrudeGeometry(shapeOf(outline,[holePts]), {depth:plate, bevelEnabled:true, bevelThickness:0.6, bevelSize:0.6, bevelSegments:2, curveSegments:24}), 1/300, 1/60);
  const topMat = mahogany.clone();
  add(topGeo, topMat, m=>{ m.position.z = -5 - plate - 0.6; });
  const backGeo = uvScale(new THREE.ExtrudeGeometry(shapeOf(outline), {depth:plate, bevelEnabled:true, bevelThickness:0.6, bevelSize:0.6, bevelSegments:2}), 1/300, 1/60);
  add(backGeo, mahogany, m=>{ m.position.z = -5 - BODY_DEPTH + 0.6; });
  const inner = insetPath(outline, 2.5);
  const sideGeo = new THREE.ExtrudeGeometry(shapeOf(outline,[inner.slice().reverse()]), {depth:BODY_DEPTH-2*plate, bevelEnabled:false, curveSegments:24});
  uvScale(sideGeo, 1/300, 1/60);
  add(sideGeo, mahoganySide, m=>{ m.position.z = -5 - BODY_DEPTH + plate; });
  // バインディング（縁の白いライン）
  const bindIn = insetPath(outline, 1.8);
  add(new THREE.ExtrudeGeometry(shapeOf(insetPath(outline,-1.0),[bindIn.slice().reverse()]), {depth:2.2, bevelEnabled:false}), binding, m=>{ m.position.z = -5 - 2.6; });   // 外側は板（輪郭+0.6）より0.4mm外へ出す（同じ面の奪い合い＝チラつきを防ぐ）
  add(new THREE.ExtrudeGeometry(shapeOf(insetPath(outline,-1.0),[bindIn.slice().reverse()]), {depth:2.2, bevelEnabled:false}), binding, m=>{ m.position.z = -5 - BODY_DEPTH + 0.4; });
  // サウンドホールの奥（暗い）とロゼッタ（飾りの輪）
  add(new THREE.CircleGeometry(SH_R+1, 48), dark, m=>{ m.position.set(SH_X, 0, -40); m.castShadow = false; });
  [[SH_R+1.5, SH_R+2.6, '#1a0e07'], [SH_R+2.6, SH_R+5.2, '#d9c9a5'], [SH_R+5.2, SH_R+6.4, '#1a0e07'], [SH_R+6.4, SH_R+7.0, '#b58a5a']].forEach(([a,b,c])=>{
    const rm = new THREE.MeshStandardMaterial({color:c, roughness:0.4, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2});
    add(new THREE.RingGeometry(a, b, 72), rm, m=>{ m.position.set(SH_X, 0, -4.9); m.castShadow=false; });
  });

  /* ブリッジ・サドル */
  const br = new THREE.Shape(); const bw = 7.5, bl = 31, rr = 6;
  br.moveTo(-bw, -bl+rr); br.lineTo(-bw, bl-rr); br.quadraticCurveTo(-bw, bl, -bw+rr, bl); br.lineTo(bw-rr, bl); br.quadraticCurveTo(bw, bl, bw, bl-rr);
  br.lineTo(bw, -bl+rr); br.quadraticCurveTo(bw, -bl, bw-rr, -bl); br.lineTo(-bw+rr, -bl); br.quadraticCurveTo(-bw, -bl, -bw, -bl+rr);
  add(new THREE.ExtrudeGeometry(br, {depth:6.5, bevelEnabled:true, bevelThickness:1, bevelSize:1, bevelSegments:3}), headWood, m=>{ m.position.set(SCALE_LEN+4, 0, -5); });
  add(new THREE.BoxGeometry(2.6, 54, 4.6), bone, m=>{ m.position.set(SCALE_LEN, 0, stringZ(SCALE_LEN) - 0.4 - 2.3); });

  /* ネック（指板の下の半楕円） */
  {
    const nx = 48, nt = 20, pos = [], idx = [], uv = [];
    const xa = -10, xb = BODY_X0 + 4;
    for(let i=0;i<=nx;i++){
      const x = xa + (xb-xa)*i/nx;
      const hw = halfW(Math.max(0,x)) + 0.2, dpt = NECK_DEPTH(Math.max(0,x));
      for(let j=0;j<=nt;j++){
        const th = Math.PI*j/nt;
        pos.push(x, hw*Math.cos(th), -5 - dpt*Math.pow(Math.sin(th), 0.85));
        uv.push(x/200, j/nt*0.3);
      }
    }
    for(let i=0;i<nx;i++) for(let j=0;j<nt;j++){ const a=i*(nt+1)+j, b=a+nt+1; idx.push(a,a+1,b, b,a+1,b+1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
    geo.setIndex(idx); geo.computeVertexNormals();
    add(geo, mahogany);
    // ヒール（ネックとボディのつなぎ目）
    const h = new THREE.Shape();
    const zN = -5 - NECK_DEPTH(BODY_X0-40);
    h.moveTo(BODY_X0-40, zN); h.quadraticCurveTo(BODY_X0-8, zN-6, BODY_X0-6, -5-BODY_DEPTH+6);
    h.lineTo(BODY_X0+3, -5-BODY_DEPTH+3); h.lineTo(BODY_X0+3, -6); h.lineTo(BODY_X0-40, -6); h.closePath();
    add(new THREE.ExtrudeGeometry(h, {depth:30, bevelEnabled:true, bevelThickness:4, bevelSize:4, bevelSegments:4}), mahogany, m=>{ m.rotation.x = Math.PI/2; m.position.y = 15; });
  }

  /* 指板（先細り）・フレット・ポジションマーク */
  {
    const geo = new THREE.BoxGeometry(1,1,1, 1,1,1);
    const p = geo.attributes.position;
    for(let i=0;i<p.count;i++){
      const X = (p.getX(i)+0.5)*FB_END;
      p.setXYZ(i, X, p.getY(i)*2*halfW(X), (p.getZ(i)-0.5)*5);
    }
    geo.computeVertexNormals();
    add(geo, rosewood);
    for(let n=1;n<=NUM_FRETS;n++){
      const x = fretX(n);
      add(new THREE.CylinderGeometry(1.25,1.25, 2*halfW(x)-0.3, 10), fretMetal, m=>{ m.position.set(x,0,0); });
    }
    const dot = (x,y)=>add(new THREE.CircleGeometry(2.9, 24), pearl, m=>{ m.position.set(x,y,0.03); m.castShadow=false; });
    [5,7,10,15].forEach(n=>dot(slotCenter(n),0));
    dot(slotCenter(12),-7); dot(slotCenter(12),7);
    // 側面のポイント
    [5,7,10,12,15].forEach(n=>add(new THREE.CylinderGeometry(1,1,0.5,12), pearl, m=>{ m.rotation.x=Math.PI/2; m.position.set(slotCenter(n), -halfW(slotCenter(n))-0.15, -2.5); }));
  }
  /* ナット */
  add(new THREE.BoxGeometry(5, 2*halfW(0)+0.6, 7.2), bone, m=>{ m.position.set(-2.5, 0, -5+3.6); });

  /* ヘッド */
  {
    const s = new THREE.Shape();
    const L = HEAD_LEN;
    s.moveTo(-5, -19.5); s.bezierCurveTo(-30,-23, -70,-31, -L+12,-31.5);
    s.quadraticCurveTo(-L,-31, -L+1,-22); s.quadraticCurveTo(-L+4,-10, -L+1,0);
    s.quadraticCurveTo(-L+4,10, -L+1,22); s.quadraticCurveTo(-L,31, -L+12,31.5);
    s.bezierCurveTo(-70,31, -30,23, -5,19.5); s.closePath();
    add(new THREE.ExtrudeGeometry(s, {depth:13, bevelEnabled:true, bevelThickness:1.2, bevelSize:1.2, bevelSegments:3, curveSegments:20}), headWood, m=>{ m.position.z = -5-13-1.2; });
    // ペグ（ギア式・ボタンは横向き）
    TUNER_POS.forEach(([x,y])=>{
      const sgn = Math.sign(y);
      add(new THREE.CylinderGeometry(3,3,11,16), chrome, m=>{ m.rotation.x=Math.PI/2; m.position.set(x,y,-5+5.5-1); });
      add(new THREE.CylinderGeometry(4.6,4.6,1.4,20), chrome, m=>{ m.rotation.x=Math.PI/2; m.position.set(x,y,-5+0.7); });
      add(new THREE.BoxGeometry(15,9,9), chrome, m=>{ m.position.set(x+2,y,-5-14.2-5); });
      add(new THREE.CylinderGeometry(1.6,1.6,16,10), chrome, m=>{ m.position.set(x+2, y+sgn*10, -5-14.2-5); });
      add(new THREE.SphereGeometry(1,24,16), binding, m=>{ m.scale.set(8,3.2,6); m.position.set(x+2, y+sgn*19.5, -5-14.2-5); });
    });
  }

  /* 弦（コードごとに形が変わる） */
  const strings = [0,1,2,3].map(()=>{
    const segs = [];
    for(let k=0;k<6;k++){ const m = new THREE.Mesh(UNIT_CYL, stringMat); m.castShadow = true; g.add(m); segs.push(m); }
    return segs;
  });
  function setStrings(strInfo){
    for(let s=0;s<4;s++){
      const r = STRING_R[s], segs = strings[s];
      const y = x => strY(s,x);
      const [tx,ty] = TUNER_POS[s];
      const post = [tx, ty - Math.sign(ty)*3.2, 2.2];
      const nut = [0, y(0), stringZ(0)+r];
      const saddle = [SCALE_LEN, y(SCALE_LEN), stringZ(SCALE_LEN)+r];
      const tie = [SCALE_LEN+9, y(SCALE_LEN), 1.6];
      const info = strInfo && strInfo[s];
      const pts = info
        ? [post, nut, [info.contact, y(info.contact), FRET_TOP+r+0.15], [info.fret, y(info.fret), FRET_TOP+r], saddle, tie]
        : [post, nut, saddle, tie];
      segs.forEach((m,k)=>{ if(k < pts.length-1) placeSeg(m, pts[k], pts[k+1], r); else m.visible = false; });
    }
  }
  setStrings(null);
  // 柄を変える（木目の絵は1回作ったら使い回す）
  const texCache = new Map();
  const wood = o => { const k = JSON.stringify(o); if(!texCache.has(k)) texCache.set(k, woodTexture(o)); return texCache.get(k); };
  function setFinish(name){
    const f = FINISHES[name] || FINISHES.mahogany;
    const set = (m, o) => {
      if(f.paint){ m.map = null; m.color.set(f.paint); }
      else { m.map = wood(o); m.color.set('#ffffff'); }
      m.roughness = f.rough; m.needsUpdate = true;
    };
    set(topMat, f.top); set(mahogany, f.back || f.top); set(mahoganySide, f.side);
  }
  return {group: g, setStrings, setFinish};
}

/* 輪切り図の断面（ネック＋指板） */
export function neckSectionShape(x){
  const s = new THREE.Shape(), hw = halfW(x), d = NECK_DEPTH(x);
  s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, -5);
  for(let j=0;j<=24;j++){ const th = Math.PI*j/24; s.lineTo(hw*Math.cos(th), -5 - d*Math.pow(Math.sin(th),0.85)); }
  s.lineTo(-hw, 0);
  return s;
}
