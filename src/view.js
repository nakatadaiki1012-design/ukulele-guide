/* =========================================================
   3D表示（three.js）：メイン画面と「輪切り」図
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildUkulele } from './uke.js';
import { createBackdrop } from './backdrop.js';
import { Q } from './quality.js';
import { loadHand, applyPose } from './handrig.js';
import { rightHandPose, STRUM_X } from './strum.js';
import { slotCenter, halfW, strY, stringZ, STRING_R, FRET_TOP, DEG } from './geom.js';
import { STRING_NAMES, FINGER_COLORS } from './data.js';

/* ウクレレは演奏する時のように立てて持っている：
   空（上）は -y（1弦Gの側）、指板の正面（客席）は +z、ボディは +x（弾く人から見て右）
   カメラの向き：el = 見下ろす角度（水平が0°）、az = 正面(+z)からボディ側(+x)へ回した角度 */
export const VIEWS = {
  diag:  {label:'ななめ', el:31, az:42, dist:260,  name:'ななめ（手の形がいちばん分かりやすい）'},
  self:  {label:'自分目線', el:58, az:6, dist:320,  name:'自分目線（上からのぞき込む）'},
  front: {label:'正面', el:8, az:3, dist:340, name:'正面（向かい合った先生から）'},
  side:  {label:'横から', el:14, az:-72, dist:320,  name:'横から（ヘッド側から）'},
  both:  {label:'両手', el:12, az:12, dist:700,  name:'両手（全体を見る）', fixed:[150, 15, -10]},
  right: {label:'右手', el:30, az:28, dist:540,  name:'右手（ストロークを見る）', fixed:[STRUM_X, 0, 25]}
};
const UP = [0,-1,0];

export async function createView({mainCanvas, mainOverlay, onTap}){
  const mkRenderer = canvas => {
    const r = new THREE.WebGLRenderer({canvas, antialias:Q.aa, alpha:false, powerPreference:'high-performance'});
    r.setPixelRatio(Math.min(window.devicePixelRatio||1, Q.pr));
    r.shadowMap.enabled = Q.shadow > 0; r.shadowMap.type = THREE.PCFShadowMap;   // やわらかい影より軽い方式
    r.shadowMap.autoUpdate = false;                                       // 影は、手が動いた時だけ描き直す（カメラを回すだけなら前の影のまま）
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    return r;
  };
  const renderer = mkRenderer(mainCanvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // 光：天井側・客席側からのやわらかい主光源＋まわりの反射
  const hemi = new THREE.HemisphereLight('#eaf6ff', '#d8c7a0', 0.7); hemi.position.set(0,-1,0);   // 上（空）は -y
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff6ea', 2.6);
  key.position.set(-160, -420, 380);   // 空の高い所（-y）・客席側（+z）から
  key.castShadow = !!Q.shadow;                                            // 「軽い」では影なし
  key.shadow.mapSize.set(Q.shadow || 512, Q.shadow || 512);
  let shadowDirty = true;                                                 // 影を描き直す必要があるか
  const touch = () => { shadowDirty = true; requestRender && requestRender(); };
  Object.assign(key.shadow.camera, {left:-300, right:300, top:300, bottom:-300, near:50, far:1400});
  key.target.position.set(150, 0, -40);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.8;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffd9b8', 0.6); rim.position.set(300, 200, 150); scene.add(rim);
  const backdrop = createBackdrop(scene, {hemi, key, rim}, [renderer]);

  // ウクレレ
  const uke = buildUkulele();
  scene.add(uke.group);
  uke.group.traverse(o=>{ if(o.material) o.material.envMapIntensity = 0.5; });

  // 手：肌は少し透明感のある質感（光が当たる縁がほんのり赤くなる）
  // （以前の「光沢の層を重ねる」質感は重いので、ふつうの質感＋赤みの足し算で似せる）
  const skin = new THREE.MeshStandardMaterial({
    color:'#e2a283', roughness:0.52, metalness:0, envMapIntensity:0.6
  });
  skin.onBeforeCompile = sh => {
    // 影の境目を赤みがかってやわらかくする（皮膚の下で光が散る感じ）
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      float wrapL = clamp(dot(normal, normalize(vec3(-0.25,-0.45,0.85)))*0.5+0.5, 0.0, 1.0);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.32,0.09,0.05) * (1.0-wrapL) * 0.9;
      float rimL = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
      reflectedLight.indirectDiffuse += vec3(1.0,0.62,0.5) * rimL * 0.12;`);
  };
  /* 腕は手首の少し先までだけ見せる：手首から30〜85mmの間で、だんだん透明にして消す */
  function addArmFade(mat, rig, depthOnly){
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev && prev.call(mat, sh, r);
      sh.uniforms.uWristP = {value: rig.fade.p}; sh.uniforms.uWristZ = {value: rig.fade.z};
      sh.vertexShader = 'uniform vec3 uWristP; uniform vec3 uWristZ; varying float vAlong;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vAlong = dot(position - uWristP, uWristZ);');
      sh.fragmentShader = 'varying float vAlong;\n' +
        sh.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          float armFade = 1.0 - smoothstep(0.03, 0.085, vAlong);
          ${depthOnly ? 'if(armFade < 0.6) discard;' : 'diffuseColor.a *= armFade*armFade*(3.0-2.0*armFade); if(diffuseColor.a < 0.004) discard;'}`);
    };
    mat.customProgramCacheKey = () => 'armfade-' + mat.uuid;
  }
  const skinLight = skin.onBeforeCompile;   // 右手にも同じ肌の質感を使う
  const rig = await loadHand(skin);
  addArmFade(skin, rig);
  scene.add(rig.root);
  // 半透明の手：先に「奥行きだけ」を描いてから、いちばん手前の皮膚だけを半透明で描く（指が重なってもにごらない）
  const depthMat = new THREE.MeshBasicMaterial({colorWrite:false});
  const handDepth = new THREE.SkinnedMesh(rig.mesh.geometry, depthMat);
  handDepth.bind(rig.mesh.skeleton, rig.mesh.bindMatrix);
  addArmFade(depthMat, rig, true);
  handDepth.frustumCulled = false; handDepth.renderOrder = 1; handDepth.visible = false;
  rig.mesh.parent.add(handDepth);
  let ghostOn = null;
  function setGhost(on){
    if(on === ghostOn) return;                // 変わった時だけ（毎コマ材質を作り直すと重い）
    ghostOn = on;
    skin.transparent = true; skin.opacity = on ? 0.6 : 1; skin.depthWrite = !on;   // 腕の先を消すので、いつも透明あり
    skin.emissive.set(on ? '#5a2a18' : '#000000');
    rig.mesh.renderOrder = on ? 2 : 0; handDepth.visible = on;
    rig.mesh.castShadow = !on;
    skin.needsUpdate = true;
  }

  // 押さえる場所の印（指の色の丸）と、弦に当たっているところの光る輪
  const marks = new THREE.Group(); scene.add(marks);
  const markMats = FINGER_COLORS.map(c => c ? new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:0.9, depthWrite:false}) : null);
  const ringMats = FINGER_COLORS.map(c => c ? new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:1, depthTest:false}) : null);
  const glowTex = (()=>{ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.35,'rgba(255,255,255,.6)'); gr.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0,0,64,64); return new THREE.CanvasTexture(c); })();
  // 弦4本ぶんの印は最初に1回だけ作っておき、毎回は位置と色を変えるだけ（毎フレーム作り直すと重い）
  const discGeo = new THREE.CircleGeometry(4.6, 32), ringGeo = new THREE.TorusGeometry(2.2, 0.45, 8, 28);
  const markSet = [0,1,2,3].map(()=>{
    const disc = new THREE.Mesh(discGeo, markMats[1]); disc.renderOrder = 3;
    // 弦が指に当たって沈んでいるところ：光る輪（手を透かして見えるように、いちばん手前に描く）
    const ring = new THREE.Mesh(ringGeo, ringMats[1]); ring.rotation.y = Math.PI/2; ring.renderOrder = 10;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, transparent:true, depthTest:false, depthWrite:false, opacity:0.9}));
    glow.scale.set(13,13,1); glow.renderOrder = 9;
    marks.add(disc, ring, glow);
    return {disc, ring, glow};
  });
  function placeMarks(pose, ghost){
    const chord = pose.chord;
    for(let s=0;s<4;s++){
      const m = markSet[s], info = pose.str[s];
      m.disc.visible = m.ring.visible = m.glow.visible = !!info;
      if(!info) continue;
      const f = chord.fingers[s] || 1;
      const x = info.contact, y = strY(s, x);
      m.disc.material = markMats[f]; m.ring.material = ringMats[f]; m.glow.material.color.set(FINGER_COLORS[f]);
      m.disc.position.set(x, y, 0.08);
      m.ring.position.set(x, y, FRET_TOP + STRING_R[s] + 0.2);
      m.glow.position.set(x, y, FRET_TOP + 1.2);
      m.ring.visible = m.glow.visible = ghost;
    }
  }
  // 右手（ストローク用）。肌の質感は左手と同じ
  const skinR = skin.clone(); skinR.onBeforeCompile = skinLight;
  const rigR = await loadHand(skinR, 'right');
  addArmFade(skinR, rigR); skinR.transparent = true;
  scene.add(rigR.root);

  // カメラ
  const camera = new THREE.PerspectiveCamera(26, 16/9, 10, 60000);   // 遠くの水平線まで見える
  let controls = null, viewName = 'diag', target = new THREE.Vector3(45, 10, -4), mirror = false;
  // カメラの操作：1本指（左ドラッグ）で回す、2本指（右ドラッグ）で平行移動、ピンチ（ホイール）で拡大
  function makeControls(cam, tgt){
    const c = new OrbitControls(cam, mainCanvas);
    c.target.copy(tgt);
    c.enablePan = true; c.screenSpacePanning = true; c.panSpeed = 0.8;
    c.minDistance = 120; c.maxDistance = 900;
    c.rotateSpeed = 0.7; c.zoomSpeed = 0.8;
    c.enableDamping = true; c.dampingFactor = 0.12;                      // 慣性：指を離してもスッとなめらかに止まる
    c.touches = {ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN};
    c.addEventListener('change', ()=>requestRender && requestRender());
    c.addEventListener('start', ()=>requestRender && requestRender());
    c.update();
    return c;
  }
  function placeCam(cam, tgt, name, scale=1){
    const v = VIEWS[name];
    if(v.fixed) tgt.set(...v.fixed);
    const narrow = mainCanvas.clientWidth < 640;
    const d = v.dist * (narrow ? 0.92 : 1) * scale;
    const el = v.el*DEG, az = v.az*DEG;
    cam.up.set(...UP);
    cam.position.copy(tgt).add(new THREE.Vector3(Math.sin(az)*Math.cos(el), -Math.sin(el), Math.cos(az)*Math.cos(el)).multiplyScalar(d));
    cam.lookAt(tgt);
  }
  function setView(name){
    viewName = name;
    if(lastT && !VIEWS[name].fixed) target.copy(lastT);
    placeCam(camera, target, name);
    if(controls) controls.dispose();
    controls = makeControls(camera, target);
  }
  // 2画面表示：右半分にもう1つの向きを同時に出す（右側もドラッグで回せる）
  const camera2 = new THREE.PerspectiveCamera(26, 1, 10, 60000);
  let view2 = 'front', controls2 = null, splitOn = false;
  const target2 = new THREE.Vector3(45, 10, -4);
  function setView2(name){
    view2 = name;
    if(!VIEWS[name].fixed) target2.copy(lastT || target);
    placeCam(camera2, target2, name, 0.9);
    if(controls2) controls2.dispose();
    controls2 = makeControls(camera2, target2);
    controls2.enabled = false;
  }
  // どちらの画面を触ったかで、動かすカメラを切り替える（OrbitControls より先に判定）
  let activePtr = 0, lastT = null;
  const pickSide = e => {
    const r = mainCanvas.getBoundingClientRect();
    let x = e.clientX - r.left; if(mainCanvas.style.transform) x = r.width - x;
    const right = splitOn && x > r.width/2;
    controls.enabled = !right; if(controls2) controls2.enabled = right;
  };
  mainCanvas.parentElement.addEventListener('pointerdown', e=>{ if(activePtr++ === 0) pickSide(e); }, true);
  window.addEventListener('pointerup', ()=>{ activePtr = Math.max(0, activePtr-1); }, true);
  window.addEventListener('pointercancel', ()=>{ activePtr = Math.max(0, activePtr-1); }, true);
  mainCanvas.parentElement.addEventListener('wheel', e=>{ if(activePtr === 0) pickSide(e); }, true);
  let requestRender = null;
  // タップ（ドラッグしなかった時）で音を鳴らす
  let down = null;
  mainCanvas.addEventListener('pointerdown', e=>{ down = [e.clientX, e.clientY]; });
  mainCanvas.addEventListener('pointerup', e=>{ if(down && Math.hypot(e.clientX-down[0], e.clientY-down[1]) < 6) onTap && onTap(); down = null; });

  function fit(r, cam, canvas){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const s = r.getSize(new THREE.Vector2());
    if(s.x !== w || s.y !== h){ r.setSize(w, h, false); setAspect(cam, w/h); }
    return [w, h];
  }
  // 縦長の画面（スマホの全画面など）では、横の見える幅が4:3の時より狭くならないように画角を広げる
  function setAspect(cam, a){
    if(Math.abs(cam.aspect - a) < 1e-4 && cam._fovSet) return;
    cam.aspect = a; cam._fovSet = true;
    cam.fov = a < 4/3 ? 2*Math.atan(Math.tan(13*DEG)*(4/3)/a)/DEG : 26;
    cam.updateProjectionMatrix();
  }
  const project = (cam, p, W, H) => { const v = new THREE.Vector3(...p).project(cam); if(v.z > 1) return null; return [(v.x+1)/2*W, (1-v.y)/2*H]; };

  const basePR = Math.min(window.devicePixelRatio||1, Q.pr);
  let curPR = basePR, lastPose = null, lastGhost = null;
  function render(pose, opts){
    // 動いている間は解像度を少し下げる（重い端末でカクカクしないように）
    const pr = Math.max(0.75, Math.round(basePR*(opts.quality ?? 1)*20)/20);
    if(pr !== curPR){ curPR = pr; renderer.setPixelRatio(pr); }
    // 左手：形が前と同じ（カメラを回しただけ）なら、計算し直さない
    if(pose !== lastPose || !!opts.ghost !== lastGhost){
      lastPose = pose; lastGhost = !!opts.ghost; shadowDirty = true;
      applyPose(rig, pose);
      uke.setStrings(pose.str);
      setGhost(!!opts.ghost);
      placeMarks(pose, !!opts.ghost);
    }
    if(opts.animating && opts.right) shadowDirty = true;                  // 右手が動いている（演奏中）
    if(rigR.root.visible !== !!opts.right) shadowDirty = true;
    renderer.shadowMap.needsUpdate = shadowDirty; shadowDirty = false;
    // 右手
    rigR.root.visible = !!opts.right;
    if(opts.right){ const rp = rightHandPose(rigR, opts.right); window.__rp = rp; applyPose(rigR, rp); }
    // コードが変わったら見る中心も少しずらす（カメラごと平行移動）。全体・右手の表示では動かさない
    const nt = new THREE.Vector3(...pose.target);
    if(!lastT) lastT = nt.clone();
    if(nt.distanceTo(lastT) > 0.01){
      const delta = nt.clone().sub(lastT); lastT.copy(nt);
      if(!VIEWS[viewName].fixed){ controls.target.add(delta); camera.position.add(delta); controls.update(); }
      if(controls2 && !VIEWS[view2].fixed){ controls2.target.add(delta); camera2.position.add(delta); controls2.update(); }
    }
    // ---- メイン ----
    const [Wc, H] = fit(renderer, camera, mainCanvas);
    mainCanvas.style.transform = opts.mirror ? 'scaleX(-1)' : '';
    let W = Wc;
    if(opts.split){
      // 左右に分けて2つの向きを描く
      W = Math.floor(Wc/2);
      setAspect(camera, W/H); setAspect(camera2, (Wc-W)/H);
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
      renderer.render(scene, camera);
      renderer.setViewport(W, 0, Wc-W, H); renderer.setScissor(W, 0, Wc-W, H);
      renderer.render(scene, camera2);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, Wc, H);
    } else {
      if(Math.abs(camera.aspect - Wc/H) > 1e-3) setAspect(camera, Wc/H);
      renderer.render(scene, camera);
    }
    let html = '';
    const P = p => { const q = project(camera, p, W, H); if(q && opts.mirror) q[0] = Wc - q[0]; return q; };
    const at = (q, cls, txt, style='') => { if(q && q[0]>-30 && q[0]<W-10 && q[1]>-30 && q[1]<H+30) html += `<div class="${cls}" style="left:${q[0].toFixed(1)}px;top:${q[1].toFixed(1)}px;${style}">${txt}</div>`; };
    const showLabels = !VIEWS[viewName].fixed;
    if(showLabels) for(let n=1; n<=5; n++) at(P([slotCenter(n), -halfW(slotCenter(n))-8, 0]), 'lab fret', n+'<small>フレット</small>');
    if(showLabels) for(let s=0; s<4; s++){
      const open = pose.chord.frets[s]===0;
      at(P([-9, strY(s,0), stringZ(0)+3]), 'lab str'+(open?' open':''), STRING_NAMES[s]+(open?'<small>○</small>':''));
    }
    if(opts.badges){
      for(let f=1; f<=4; f++){
        const F = pose.fingers[f]; if(F.mode==='hover') continue;
        const q = P(F.pts[3]);
        if(q) at([q[0], q[1]-30], 'fbadge', f, `background:${FINGER_COLORS[f]}`);
        if(opts.split){   // 右側の画面にも指番号
          const q2 = project(camera2, F.pts[3], Wc-W, H);
          if(q2 && q2[0]>0 && q2[0]<Wc-W) html += `<div class="fbadge" style="left:${(q2[0]+W).toFixed(1)}px;top:${(q2[1]-30).toFixed(1)}px;background:${FINGER_COLORS[f]}">${f}</div>`;
        }
      }
    }
    if(opts.split) html += `<div class="splitline" style="left:${W}px"></div>`;
    if(mainOverlay._html !== html){ mainOverlay._html = html; mainOverlay.innerHTML = html; }   // 変わった時だけ書き換える
  }

  setView('diag'); setView2('front');
  backdrop.set('day');
  return {
    render, setView, rig, rigR, rightHandPose, get info(){ return renderer.info; },
    setView2,
    setBackdrop: name => { backdrop.set(name); touch(); },
    setFinish: name => { uke.setFinish(name); touch(); },
    // 毎コマ呼ぶ：カメラの慣性を進める。カメラがまだ動いていれば true
    tick(){
      let ch = false;
      if(controls) ch = controls.update() || ch;
      if(controls2 && splitOn) ch = controls2.update() || ch;
      return ch || activePtr > 0;
    },
    // 処理が重い端末向け：影を切る（いちど切ると戻さない）
    setShadows(on){
      if(key.castShadow === on) return;
      key.castShadow = on; shadowDirty = true;
      scene.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate = true); } });
    }, get cams(){ return [camera.position.toArray(), camera2.position.toArray(), controls.target.toArray()]; },
    setSplit(on){ splitOn = on; if(!on){ controls.enabled = true; if(controls2) controls2.enabled = false; } },
    debugCam(pos, look){ camera.position.set(...pos); controls.target.set(...look); controls.update(); },
    onChange(fn){ requestRender = fn; },
    get viewName(){ return viewName; }
  };
}
