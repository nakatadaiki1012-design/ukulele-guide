/* =========================================================
   背景（実物の大きさ）：昼の砂浜・夕焼けの砂浜・夜の砂浜・海の家・野原
   ウクレレは立てて構えている。空（上）は -y、客席（正面）は +z、
   弾く人の後ろ（-z）の先に波打ち際と海（野原では丘）、その先に地平線
   単位はmm。地面はウクレレの約0.9m下（立って胸の前で構えた高さ）
   画像ファイルは使わず、その場で描いた絵を貼るだけ。選んだ時に初めて作り、あとは使い回す
   ========================================================= */
import * as THREE from 'three';
import { Q } from './quality.js';
// 軽さ：絵の大きさは D 倍（描く座標はそのままで、キャンバスだけ小さくする）、模様の数は Q.bg 倍
const D = Math.sqrt(Q.bg), CNT = n => Math.max(1, Math.round(n*Q.bg));

function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.round(w*D); c.height = Math.round(h*D); const g = c.getContext('2d'); g.scale(D, D); return [c, g]; };
const tex = (c, repeat) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if(repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };

const GROUND_Y = 900;          // 地面の高さ（ウクレレの中心から下へ90cm）
const SHORE_Z = -2600;         // 波打ち際（弾く人の後ろ2.6m）
const NEAR_Z = 9000, FAR_Z = -16000, HALF_X = 16000;
const vOf = z => (NEAR_Z - z)/(NEAR_Z - FAR_Z);   // z → 0（手前）〜1（奥）

/* ---------- 近くで見た時の細かい模様（くり返し貼る） ---------- */
function sandGrain(){
  const N = 512, [c, g] = canvas(N, N), r = rng(11);
  g.fillStyle = '#d9c7a0'; g.fillRect(0, 0, N, N);
  const cols = ['rgba(255,250,235,0.35)','rgba(170,138,98,0.25)','rgba(120,100,80,0.18)','rgba(235,215,180,0.4)','rgba(90,80,75,0.12)'];
  for(let i=0;i<CNT(30000);i++){ g.fillStyle = cols[(r()*cols.length)|0]; g.beginPath(); g.arc(r()*N, r()*N, 0.5+r()*1.1, 0, 6.283); g.fill(); }
  for(let i=0;i<40;i++){ g.fillStyle = `rgba(250,240,225,${0.5+r()*0.4})`; g.beginPath(); g.ellipse(r()*N, r()*N, 1.5+r()*3, 1+r()*2, r()*3, 0, 6.283); g.fill(); }
  return c;
}
function grassGrain(){
  const N = 512, [c, g] = canvas(N, N), r = rng(17);
  g.fillStyle = '#5f8f3a'; g.fillRect(0, 0, N, N);
  const greens = ['#4a7a2c','#6fa045','#86b555','#3d6824','#9cc466','#557f30'];
  for(let i=0;i<CNT(9000);i++){                  // 草の葉：短い線をいろいろな向き・緑で
    const x = r()*N, y = r()*N, l = 4+r()*10, a = -1.9 + (r()-0.5)*1.4;
    g.strokeStyle = greens[(r()*greens.length)|0]; g.globalAlpha = 0.5+r()*0.5; g.lineWidth = 0.8+r()*1.4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x+Math.cos(a)*l, y+Math.sin(a)*l); g.stroke();
  }
  g.globalAlpha = 1;
  for(let i=0;i<70;i++){                         // 小さな花（白・黄色・うす紫）
    g.fillStyle = ['#fffdf2','#ffe45c','#d9c4ff'][(r()*3)|0];
    const x = r()*N, y = r()*N; for(let k=0;k<5;k++){ g.beginPath(); g.arc(x+Math.cos(k*1.26)*1.6, y+Math.sin(k*1.26)*1.6, 1.3, 0, 6.283); g.fill(); }
  }
  return c;
}
function plankGrain(){
  const W = 512, H = 512, [c, g] = canvas(W, H), r = rng(29);
  const n = 4, ph = H/n;                          // 板4枚（1枚12.5cm）
  for(let i=0;i<n;i++){
    const tone = 0.85 + r()*0.25;
    g.fillStyle = `rgb(${(176*tone)|0},${(128*tone)|0},${(86*tone)|0})`; g.fillRect(0, i*ph, W, ph);
    for(let k=0;k<40;k++){                        // 木目
      const y0 = i*ph + r()*ph, amp = 1+r()*3, f = r()*3;
      g.strokeStyle = r()<0.6 ? 'rgba(90,55,30,0.18)' : 'rgba(230,190,140,0.18)'; g.lineWidth = 0.6+r()*1.5;
      g.beginPath(); for(let x=0;x<=W;x+=8){ const y = y0 + Math.sin(x/W*6.28*f + k)*amp; x?g.lineTo(x,y):g.moveTo(x,y); } g.stroke();
    }
    g.fillStyle = 'rgba(40,24,12,0.75)'; g.fillRect(0, i*ph, W, 3);           // 板のすき間
    const cut = r()*W; g.fillRect(cut, i*ph, 2, ph);                           // 板の継ぎ目
    g.fillStyle = 'rgba(60,60,60,0.6)'; [cut-12, cut+14].forEach(x=>{ g.beginPath(); g.arc(x, i*ph+ph*0.3, 2, 0, 6.283); g.arc(x, i*ph+ph*0.7, 2, 0, 6.283); g.fill(); });
  }
  return c;
}
// 細かい模様の平均の色（シェーダーで割って、明るさを変えずに模様だけ足すため）
function meanLinear(c){
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let R=0,G=0,B=0; const n = d.length/4;
  for(let i=0;i<d.length;i+=4){ R+=d[i]; G+=d[i+1]; B+=d[i+2]; }
  const lin = v => Math.pow(v/n/255, 2.2);
  return [lin(R), lin(G), lin(B)];
}

/* ---------- 遠くから見た時の地面全体の模様（v=0 が手前、v=1 が奥） ---------- */
function shoreTexture(o){
  const W = 1024, H = 2048, [c, g] = canvas(W, H), r = rng(5);
  const yOf = z => H*(1 - vOf(z)), shoreY = yOf(SHORE_Z);
  const grd = g.createLinearGradient(0, H, 0, 0);
  const st = (z, col) => grd.addColorStop(Math.min(1, Math.max(0, vOf(z))), col);
  const S = o.sand, Wt = o.water;
  st(NEAR_Z, S[0]); st(0, S[0]); st(-1500, S[1]);
  st(SHORE_Z+500, S[2]); st(SHORE_Z+60, S[3]);                               // 濡れた砂
  st(SHORE_Z, Wt[0]); st(SHORE_Z-250, Wt[1]); st(SHORE_Z-900, Wt[2]);         // 泡 → 浅瀬
  st(SHORE_Z-3000, Wt[3]); st(SHORE_Z-7000, Wt[4]); st(FAR_Z, Wt[5]);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  for(let i=0;i<CNT(900);i++){                    // 乾いた砂のまだら
    const x = r()*W, y = shoreY + 40 + r()*(H-shoreY-40), rr = 20+r()*90;
    g.fillStyle = r()<0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(140,110,70,0.05)';
    g.beginPath(); g.ellipse(x, y, rr*1.6, rr, 0, 0, 6.283); g.fill();
  }
  g.lineWidth = 1.2;
  for(let i=0;i<CNT(260);i++){                    // 風紋
    const y0 = shoreY + 80 + r()*(H-shoreY-80), x0 = r()*W, len = 60+r()*220, ph = r()*6;
    g.strokeStyle = `rgba(150,120,80,${0.05+r()*0.06})`; g.beginPath();
    for(let k=0;k<=len;k+=6){ const x = x0+k, y = y0 + Math.sin(k/40+ph)*3; k?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
  }
  const wave = (y0, amp, a, w) => {               // 波の泡
    g.strokeStyle = `rgba(${o.foam},${a})`; g.lineWidth = w; g.beginPath();
    const ph = r()*6.28, f1 = 2+r()*2, f2 = 9+r()*5;
    for(let x=0;x<=W;x+=4){ const y = y0 + Math.sin(x/W*6.28*f1+ph)*amp + Math.sin(x/W*6.28*f2+ph*2)*amp*0.3; x?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
  };
  wave(shoreY+3, 5, 0.95, 4); wave(shoreY-4, 6, 0.6, 2);
  wave(shoreY-22, 7, 0.45, 3); wave(shoreY-50, 8, 0.3, 2); wave(shoreY-110, 9, 0.18, 2); wave(shoreY-200, 10, 0.1, 2);
  for(let i=0;i<CNT(3000);i++){ g.fillStyle = `rgba(255,255,255,${(0.05+r()*0.18)*o.sparkle})`; g.fillRect(r()*W, r()*(shoreY-20), 1+r()*5, 1); }
  if(o.glitter){                                  // 太陽・月の光の道（正面の奥から手前へ）
    for(let i=0;i<CNT(5000);i++){
      const y = r()*(shoreY-30), spread = 30 + (1 - y/shoreY)*0 + (y/shoreY)*120;
      const x = W/2 + (r()+r()+r()-1.5)*spread;
      g.fillStyle = `rgba(${o.glitter},${0.25+r()*0.6})`; g.fillRect(x, y, 2+r()*9, 1+r()*1.2);
    }
  }
  return tex(c);
}
function meadowTexture(){
  const W = 1024, H = 2048, [c, g] = canvas(W, H), r = rng(31);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  for(let i=0;i<CNT(1400);i++){                   // 明るい所・暗い所のむら
    const x = r()*W, y = r()*H, rr = 15+r()*110;
    g.fillStyle = r()<0.5 ? 'rgba(255,255,210,0.10)' : 'rgba(40,70,20,0.10)';
    g.beginPath(); g.ellipse(x, y, rr*1.5, rr, r()*3, 0, 6.283); g.fill();
  }
  for(let i=0;i<CNT(220);i++){                    // 花の群れ
    const x = r()*W, y = r()*H*0.8, col = ['255,250,235','255,226,90','215,190,255'][(r()*3)|0];
    for(let k=0;k<30;k++){ g.fillStyle = `rgba(${col},0.7)`; g.fillRect(x+(r()-0.5)*40, y+(r()-0.5)*16, 2, 2); }
  }
  // 小道（土）：手前から奥へゆるく曲がる
  g.strokeStyle = 'rgba(150,120,80,0.55)'; g.lineWidth = 26; g.lineCap = 'round'; g.beginPath();
  for(let y=H; y>=H*0.25; y-=10){ const x = W*0.72 + Math.sin(y/H*5)*60 - (H-y)*0.05; y===H?g.moveTo(x,y):g.lineTo(x,y); }
  g.stroke();
  return tex(c);
}

/* ---------- 空：v=0.5 が地平線、v=1 が真上。u=0.25 が海の方（-z） ---------- */
function skyTexture(o){
  const W = 2048, H = 1024, [c, g] = canvas(W, H), r = rng(43);
  const grd = g.createLinearGradient(0, H, 0, 0);
  for(const [v, col] of o.stops) grd.addColorStop(v, col);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const P = (u, v) => [u*W, (1-v)*H];
  if(o.stars){
    for(let i=0;i<CNT(o.stars);i++){ const v = 0.52 + Math.pow(r(), 0.7)*0.48, [x, y] = P(r(), v), s = r();
      g.fillStyle = `rgba(255,255,255,${0.3+s*0.7})`; g.fillRect(x, y, s>0.95?2.5:1.2, s>0.95?2.5:1.2); }
  }
  if(o.clouds){
    for(let i=0;i<CNT(o.clouds);i++){
      const [cx, cy] = P(r(), 0.54 + r()*0.25), w = 80+r()*220;
      for(let k=0;k<14;k++){ const gx = cx+(r()-0.5)*w, gy = cy+(r()-0.5)*w*0.12, rr = w*(0.08+r()*0.12);
        const gr = g.createRadialGradient(gx, gy, 0, gx, gy, rr); gr.addColorStop(0, `rgba(${o.cloudCol},0.55)`); gr.addColorStop(1, `rgba(${o.cloudCol},0)`);
        g.fillStyle = gr; g.fillRect(gx-rr, gy-rr*0.6, rr*2, rr*1.2); }
    }
  }
  const disc = (d, glow) => {
    const [x, y] = P(d.u, d.v);
    const gr = g.createRadialGradient(x, y, 0, x, y, d.r*glow);
    gr.addColorStop(0, d.col); gr.addColorStop(0.08, d.col); gr.addColorStop(0.25, d.halo); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, d.r*glow, 0, 6.283); g.fill();
    g.fillStyle = d.col; g.beginPath(); g.arc(x, y, d.r, 0, 6.283); g.fill();
  };
  if(o.sun) disc(o.sun, 9);
  if(o.moon){ disc(o.moon, 6);
    const [x, y] = P(o.moon.u, o.moon.v); g.fillStyle = 'rgba(160,170,190,0.35)';
    [[-3,-2,3],[4,3,2.2],[1,-5,1.6]].forEach(([dx,dy,rr])=>{ g.beginPath(); g.arc(x+dx, y+dy, rr, 0, 6.283); g.fill(); }); }
  if(o.hills){                                    // 遠くの丘と木（地平線の上）
    const layer = (col, base, amp, f, ph) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H/2);
      for(let x=0;x<=W;x+=8){ const v = base + amp*(0.5+0.5*Math.sin(x/W*6.28*f+ph))*(0.6+0.4*Math.sin(x/W*6.28*f*2.3+ph*2)); g.lineTo(x, (1-v)*H); }
      g.lineTo(W, H/2+4); g.lineTo(0, H/2+4); g.fill(); };
    layer('#a9c7b4', 0.5, 0.035, 3, 1); layer('#86ad86', 0.5, 0.022, 5, 2.5);
    g.fillStyle = '#5f8a5c';
    for(let i=0;i<CNT(160);i++){ const [x, y] = P(r(), 0.502); const s = 3+r()*6; g.beginPath(); g.arc(x, y-s, s, 0, 6.283); g.fill(); g.fillRect(x-0.8, y-s, 1.6, s); }
  }
  return tex(c);
}

/* ---------- 部品 ---------- */
// 地面：細かい模様（くり返し）× 全体の模様。遠くは細かい模様を消して全体の色だけにする
function ground(grainCanvas, tileMM, large, landV=1){
  const geo = new THREE.PlaneGeometry(2*HALF_X, NEAR_Z - FAR_Z);
  geo.rotateX(Math.PI/2);                                   // 法線 +z → -y（上向き）
  const grain = tex(grainCanvas, true);
  grain.repeat.set(2*HALF_X/tileMM, (NEAR_Z - FAR_Z)/tileMM);
  const mean = meanLinear(grainCanvas).map(v=>v.toFixed(4)).join(',');
  const mat = new THREE.MeshLambertMaterial({map: grain});
  mat.onBeforeCompile = sh => {
    sh.uniforms.uLarge = {value: large};
    sh.vertexShader = 'varying vec2 vLargeUv; varying float vViewDist;\n' + sh.vertexShader
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vLargeUv = vec2(uv.x, 1.0 - uv.y);')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n vViewDist = -mvPosition.z;');
    sh.fragmentShader = 'uniform sampler2D uLarge; varying vec2 vLargeUv; varying float vViewDist;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      `vec4 grainC = texture2D(map, vMapUv);
       vec4 largeC = texture2D(uLarge, vLargeUv);
       float far = smoothstep(2500.0, 9000.0, vViewDist);
       vec3 detail = mix(grainC.rgb / vec3(${mean}), vec3(1.0), far);
       float land = 1.0 - smoothstep(${(landV-0.006).toFixed(4)}, ${(landV+0.002).toFixed(4)}, vLargeUv.y);
       diffuseColor.rgb *= largeC.rgb * mix(vec3(1.0), detail, land);`);
  };
  mat.customProgramCacheKey = () => 'ground-' + mean + landV;
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, GROUND_Y, (NEAR_Z + FAR_Z)/2);
  return m;
}
function farPlane(color){                                    // 地面のさらに先から地平線まで
  const geo = new THREE.PlaneGeometry(2*HALF_X*4, 60000); geo.rotateX(Math.PI/2);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color}));
  m.position.set(0, GROUND_Y + 2, FAR_Z - 30000 + 10);
  return m;
}
function skyDome(t){
  const m = new THREE.Mesh(new THREE.SphereGeometry(50000, Q.bg < 1 ? 24 : 48, Q.bg < 1 ? 12 : 24),
    new THREE.MeshBasicMaterial({map: t, side: THREE.BackSide, depthWrite: false, fog: false}));
  m.rotation.x = Math.PI;                                    // 球の上 +y を空の上 -y に向ける
  m.position.y = GROUND_Y;
  return m;
}
function beach(o){
  const grp = new THREE.Group();
  const sand = sandGrain();
  grp.add(ground(sand, 400, shoreTexture(o.shore), vOf(SHORE_Z)), farPlane(o.shore.water[5]), skyDome(skyTexture(o.sky)));
  return grp;
}

/* ---------- 背景の種類 ---------- */
const DAY_SHORE = { sand:['#fbf3e2','#f6ead2','#d9c6a2','#b9a27c'], water:['#eaf3ee','#bfe6df','#74cdc8','#2fa9b5','#167f9e','#0f6b8e'], foam:'255,255,255', sparkle:1 };
const DAY_SKY = { stops:[[0,'#dff1f4'],[0.5,'#dff1f4'],[0.53,'#cdeaf3'],[0.62,'#9fd3ee'],[1,'#4f9fd8']], clouds:26, cloudCol:'255,255,255' };
export const BACKDROPS = {
  day: { label:'昼の砂浜', build: () => beach({shore: DAY_SHORE, sky: DAY_SKY}),
    env: { fog:'#dff1f4', near:6000, far:42000, hemi:['#eaf6ff','#d8c7a0',0.7], key:['#fff6ea',2.6], rim:['#ffd9b8',0.6], envI:1, exposure:1.05 } },
  sunset: { label:'夕焼けの砂浜',
    build: () => beach({
      shore: { sand:['#f0d2b0','#e8c39c','#c79a78','#9c735a'], water:['#f6d9c4','#e9a98c','#b5767a','#6d5378','#3f3d68','#2e3158'], foam:'255,236,220', sparkle:0.6, glitter:'255,190,120' },
      sky: { stops:[[0,'#f2b48a'],[0.5,'#ffcf8a'],[0.52,'#ffb070'],[0.58,'#f0805a'],[0.7,'#b8607a'],[0.85,'#5d4a86'],[1,'#2b3366']],
             sun:{u:0.25, v:0.515, r:26, col:'#fff1c4', halo:'rgba(255,170,90,0.5)'}, clouds:18, cloudCol:'255,150,120' } }),
    env: { fog:'#f2b48a', near:5000, far:40000, hemi:['#ffc9a0','#6b4a3a',0.65], key:['#ffb47c',2.3], rim:['#ff8a50',1.4], envI:0.7, exposure:1.0 } },
  night: { label:'夜の砂浜',
    build: () => beach({
      shore: { sand:['#c9cbd6','#bfc2cf','#9a9cad','#7c7f92'], water:['#c4cbd8','#7f8ea8','#41557a','#22325a','#16224a','#101a3c'], foam:'225,232,250', sparkle:0.25, glitter:'215,225,255' },
      sky: { stops:[[0,'#1a2342'],[0.5,'#2a3a66'],[0.52,'#1f2d55'],[0.62,'#121c3c'],[1,'#060a1c']],
             moon:{u:0.25, v:0.62, r:16, col:'#f4f1e2', halo:'rgba(170,190,255,0.25)'}, stars:2200 } }),
    env: { fog:'#1a2342', near:3000, far:30000, hemi:['#5b6fa8','#1c1c28',0.55], key:['#c9d6ff',1.7], rim:['#ffcf8f',0.9], envI:0.35, exposure:1.0 } },
  house: { label:'海の家',
    build: () => {
      const grp = beach({shore: DAY_SHORE, sky: DAY_SKY});
      // 木のデッキ（地面より15cm高い）と柱・屋根・手すり・テーブル
      const plank = tex(plankGrain(), true); plank.repeat.set(6000/1000, 4600/500);
      const deckGeo = new THREE.PlaneGeometry(6000, 4600); deckGeo.rotateX(Math.PI/2);
      const deck = new THREE.Mesh(deckGeo, new THREE.MeshLambertMaterial({map: plank}));
      deck.position.set(0, GROUND_Y - 150, -500); grp.add(deck);
      const woodM = new THREE.MeshLambertMaterial({color:'#9a6a42'}), whiteM = new THREE.MeshLambertMaterial({color:'#f4efe6'});
      const box = (w, h, d, x, y, z, m=woodM) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); grp.add(b); return b; };
      const top = GROUND_Y - 2700;
      for(const x of [-2900, 2900]) for(const z of [1700, -2700]) box(140, 2700, 140, x, GROUND_Y - 1350, z);
      box(6200, 120, 4800, 0, top - 60, -500, whiteM);                          // 屋根
      for(let i=0;i<9;i++) box(6200, 40, 140, 0, top + 20, 1700 - i*550);       // 屋根の梁
      box(5800, 70, 70, 0, GROUND_Y - 1050, -2700); box(5800, 50, 50, 0, GROUND_Y - 600, -2700);   // 手すり
      for(let x=-2700; x<=2700; x+=450) box(40, 900, 40, x, GROUND_Y - 600, -2700);
      box(1200, 50, 700, -1900, GROUND_Y - 850, -1400);                         // テーブル
      for(const [dx, dz] of [[-500,-280],[500,-280],[-500,280],[500,280]]) box(50, 650, 50, -1900+dx, GROUND_Y - 475, -1400+dz);
      const lanternM = new THREE.MeshBasicMaterial({color:'#ffd27a'});
      for(const x of [-1800, 0, 1800]){ box(10, 400, 10, x, top + 220, -800); const l = new THREE.Mesh(new THREE.SphereGeometry(110, 16, 12), lanternM); l.position.set(x, top + 520, -800); grp.add(l); }
      return grp;
    },
    env: { fog:'#dff1f4', near:6000, far:42000, hemi:['#f4ead8','#b08860',0.75], key:['#fff0dc',2.4], rim:['#ffd9b8',0.7], envI:0.9, exposure:1.02 } },
  meadow: { label:'野原',
    build: () => {
      const grp = new THREE.Group();
      grp.add(ground(grassGrain(), 600, meadowTexture(), 2), farPlane('#6f9a55'),
        skyDome(skyTexture({ stops:[[0,'#e6f2e8'],[0.5,'#e6f2e8'],[0.53,'#d4ecf6'],[0.62,'#a6d4f2'],[1,'#5a9fdc']], clouds:34, cloudCol:'255,255,255', hills:true })));
      return grp;
    },
    env: { fog:'#dbeee6', near:5000, far:40000, hemi:['#eaf6ff','#7f9a5a',0.7], key:['#fff6ea',2.6], rim:['#ffe6c0',0.6], envI:1, exposure:1.05 } },
};

/* 背景を切り替える。lights = {hemi, key, rim}、renderers = 使っている描画の道具 */
export function createBackdrop(scene, lights, renderers){
  const built = {};
  let cur = null;
  function set(name){
    const B = BACKDROPS[name] || BACKDROPS.day;
    if(cur) cur.visible = false;
    if(!built[name]){ built[name] = B.build(); scene.add(built[name]); }
    cur = built[name]; cur.visible = true;
    const e = B.env;
    scene.fog = new THREE.Fog(e.fog, e.near, e.far);
    scene.background = new THREE.Color(e.fog);
    lights.hemi.color.set(e.hemi[0]); lights.hemi.groundColor.set(e.hemi[1]); lights.hemi.intensity = e.hemi[2];
    lights.key.color.set(e.key[0]); lights.key.intensity = e.key[1];
    lights.rim.color.set(e.rim[0]); lights.rim.intensity = e.rim[1];
    // まわりの映り込みの明るさ（夜は控えめに）
    scene.traverse(o=>{ if(!o.material) return; (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
      if(m.envMapIntensity === undefined) return;
      m.userData.envBase ??= m.envMapIntensity; m.envMapIntensity = m.userData.envBase * e.envI; }); });
    renderers.forEach(r=>r.toneMappingExposure = e.exposure);
  }
  return { set };
}
