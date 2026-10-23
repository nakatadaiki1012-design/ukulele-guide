/* =========================================================
   手の3Dモデル（関節に骨が入ったもの）を読み込んで動かす
   モデル：WebXR Input Profiles「generic-hand」左手・右手（MIT License, Copyright (c) 2019 Amazon）
   関節の向きのルール（WebXR）：-Z が指先の方向、+Y が手の甲の方向
   ========================================================= */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import leftGlb from '../node_modules/@webxr-input-profiles/assets/dist/profiles/generic-hand/left.glb';
import rightGlb from '../node_modules/@webxr-input-profiles/assets/dist/profiles/generic-hand/right.glb';
import { sub, vlen, norm, cross, dot, mul } from './geom.js';
import { smoothSkinnedGeometry } from './subdivide.js';
import { Q } from './quality.js';

export const FINGER_KEYS = ['', 'index', 'middle', 'ring', 'pinky'];
const FINGER_JOINTS = ['metacarpal','phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'];
export const THUMB_JOINTS = ['thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip'];
export const jointName = (f, i) => `${FINGER_KEYS[f]}-finger-${FINGER_JOINTS[i]}`;

export async function loadHand(skinMaterial, side='left'){
  const handGlb = side === 'right' ? rightGlb : leftGlb;
  const gltf = await new Promise((res, rej)=>new GLTFLoader().parse(handGlb.buffer.slice(handGlb.byteOffset, handGlb.byteOffset+handGlb.byteLength), '', res, rej));
  const root = new THREE.Group();
  root.scale.setScalar(1000);              // モデルはメートル、この画面はmm
  root.add(gltf.scene);
  const bones = {};
  let mesh = null;
  gltf.scene.traverse(o=>{
    if(o.isBone || (o.name && /finger|thumb|wrist/.test(o.name) && !o.isMesh)) bones[o.name] = o;
    if(o.isSkinnedMesh) mesh = o;
  });
  // 前腕の骨を足す（手首で腕を曲げられるように）。基本姿勢では手首の骨と同じ位置・向き
  const forearm = new THREE.Bone(); forearm.name = 'forearm';
  forearm.position.copy(bones['wrist'].position); forearm.quaternion.copy(bones['wrist'].quaternion);
  bones['wrist'].parent.add(forearm); bones['forearm'] = forearm;
  const sk = mesh.skeleton;
  const wristIdx = sk.bones.indexOf(bones['wrist']);
  const newBones = [...sk.bones, forearm];
  const newInv = [...sk.boneInverses.map(m=>m.clone()), sk.boneInverses[wristIdx].clone()];
  extendForearm(mesh.geometry, bones['wrist'], wristIdx, sk.bones.length);
  sharpenWebs(mesh.geometry, bones, sk.bones);
  mesh.geometry = smoothSkinnedGeometry(mesh.geometry, Q.subdiv);   // 軽さの設定で、なめらかにする回数を変える
  mesh.bind(new THREE.Skeleton(newBones, newInv), mesh.bindMatrix);
  mesh.material = skinMaterial;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // 基本姿勢での関節位置（手首から見た位置, mm）
  const wrist = bones['wrist'];
  const wq = wrist.quaternion.clone(), wqi = wq.clone().invert(), wp = wrist.position.clone();
  const rest = {}, restBasis = {};
  for(const name in bones){
    const v = bones[name].position.clone().sub(wp).applyQuaternion(wqi).multiplyScalar(1000);
    rest[name] = [v.x, v.y, v.z];
    // 基本姿勢での骨の向き（手首から見た X・Y・Z 軸）… ねじれを自然にするのに使う
    const q = wqi.clone().multiply(bones[name].quaternion);
    restBasis[name] = [[1,0,0],[0,1,0],[0,0,1]].map(a=>new THREE.Vector3(...a).applyQuaternion(q).toArray());
  }
  const P = n => rest[n];
  const dist = (a,b) => vlen(sub(P(a),P(b)));
  // 骨の長さ（このモデルの実寸）
  const lengths = {};
  for(let f=1; f<=4; f++) lengths[f] = [1,2,3].map(i=>dist(jointName(f,i), jointName(f,i+1)));
  const thumbLengths = [0,1,2].map(i=>dist(THUMB_JOINTS[i], THUMB_JOINTS[i+1]));

  const m4 = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
  function setBone(name, pos, fwd, dorsal){
    const b = bones[name]; if(!b) return;
    b.position.set(pos[0]/1000, pos[1]/1000, pos[2]/1000);
    const z = norm(mul(fwd,-1));
    let y = sub(dorsal, mul(z, dot(dorsal,z)));
    y = vlen(y) < 1e-4 ? norm(cross(z,[1,0,0])) : norm(y);
    const x = cross(y, z);
    vx.set(...x); vy.set(...y); vz.set(...z);
    m4.makeBasis(vx, vy, vz);
    b.quaternion.setFromRotationMatrix(m4);
  }
  // 前腕を手首の少し先で消していくための情報（モデルの元の座標での手首の位置と、腕の方向）
  const fade = { p: wp.clone(), z: new THREE.Vector3(0,0,1).applyQuaternion(wq) };
  return { root, mesh, bones, rest, restBasis, lengths, thumbLengths, setBone, fade };
}

/* モデルは手首の先が丸く閉じているので、その部分を引き伸ばして前腕にする。
   手首の関節から見て（指先が -Z）、z=0〜16mm はほぼ同じ太さの筒、16〜24mm が丸いふた（実測） */
function extendForearm(geo, wrist, wristIdx, forearmIdx){
  const P = geo.attributes.position;
  const qi = wrist.quaternion.clone().invert(), q = wrist.quaternion.clone(), wp = wrist.position.clone();
  const v = new THREE.Vector3();
  const Z0 = 0.008, Z1 = 0.016, LEN = 0.11;          // メートル（表示は手首の少し先まで。先はぼかして消す）
  for(let i=0;i<P.count;i++){
    v.fromBufferAttribute(P, i).sub(wp).applyQuaternion(qi);
    if(v.z <= 0) continue;
    let z = v.z, t = 0;
    if(v.z > Z0){
      if(v.z < Z1){ t = (v.z-Z0)/(Z1-Z0); z = Z0 + t*LEN; }
      else { t = 1; z = Z0 + LEN + (v.z-Z1)*2.5; }
    }
    // 手首より腕側は「前腕の骨」に少しずつ受け渡す（手首でなめらかに曲がる）
    const wf = Math.min(1, Math.max(0, (z-0.003)/0.045)), sm = wf*wf*(3-2*wf);
    geo.attributes.skinIndex.setXYZW(i, wristIdx, forearmIdx, 0, 0);
    geo.attributes.skinWeight.setXYZW(i, 1-sm, sm, 0, 0);
    if(v.z <= Z0) continue;
    const grow = 1 + 0.22*Math.pow(t,0.8);              // 肘に向かって少し太く
    v.set(v.x*grow, (v.y+2e-3)*grow-2e-3, z);
    v.applyQuaternion(q).add(wp);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  P.needsUpdate = true;
  geo.attributes.skinIndex.needsUpdate = true; geo.attributes.skinWeight.needsUpdate = true;
}

/* 指の股の皮膚：モデルでは隣の指どうしの影響が第一関節の半分近くまで混ざっていて、
   指を別々に曲げると「水かき」のように膜が張って指がくっついて見える。
   付け根の近く（股の深さ約8mm）だけ混ぜて、それより先はいちばん近い指の骨だけに従わせる */
function sharpenWebs(geo, bones, skBones){
  const P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const F = ['index','middle','ring','pinky'];
  const seg = F.map(f=>{
    const ids = ['phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'].map(j=>bones[`${f}-finger-${j}`]);
    return { pts: ids.map(b=>b.position.clone()), idx: ids.slice(0,3).map(b=>skBones.indexOf(b)) };
  });
  const fingerOf = new Map();
  seg.forEach((sg,k)=>sg.idx.forEach(i=>fingerOf.set(i,k)));
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  const segD = (p,a,b) => { const ab = b.clone().sub(a); const t = Math.min(1,Math.max(0, p.clone().sub(a).dot(ab)/ab.lengthSq())); return p.distanceTo(q.copy(a).addScaledVector(ab,t)); };
  for(let i=0;i<P.count;i++){
    const js = [SI.getX(i),SI.getY(i),SI.getZ(i),SI.getW(i)], ws = [SW.getX(i),SW.getY(i),SW.getZ(i),SW.getW(i)];
    const per = new Map();
    js.forEach((j,k)=>{ if(ws[k]>0 && fingerOf.has(j)){ const f = fingerOf.get(j); per.set(f,(per.get(f)||0)+ws[k]); } });
    if(per.size < 2) continue;
    v.fromBufferAttribute(P,i);
    // いちばん近い指と、その指の付け根からの距離
    let best = -1, bd = 1e9;
    for(const f of per.keys()){ const sg = seg[f]; const d = Math.min(segD(v,sg.pts[0],sg.pts[1]), segD(v,sg.pts[1],sg.pts[2])); if(d<bd){ bd=d; best=f; } }
    const sg = seg[best], ax = sg.pts[1].clone().sub(sg.pts[0]);
    const along = v.clone().sub(sg.pts[0]).dot(ax.clone().normalize());
    const keep = Math.min(1, Math.max(0, (along-0.004)/0.006));   // 0〜1：付け根から4〜10mmで切り替え
    if(keep <= 0) continue;
    for(let k=0;k<4;k++){
      if(!fingerOf.has(js[k])) continue;
      if(fingerOf.get(js[k]) !== best) ws[k] *= (1-keep);
    }
    const sum = ws.reduce((a,b)=>a+b,0) || 1;
    SW.setXYZW(i, ws[0]/sum, ws[1]/sum, ws[2]/sum, ws[3]/sum);
  }
  SW.needsUpdate = true;
}

// ポーズ（関節の位置と向き）をモデルに反映
export function applyPose(rig, pose){
  for(const j of pose.joints) rig.setBone(j.name, j.pos, j.fwd, j.dorsal);
}
