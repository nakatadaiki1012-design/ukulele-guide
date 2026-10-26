/* =========================================================
   右手のストローク
   ・手の形：人差し指は第2・第3関節（付け根側の2つ）を軽く曲げた「かぎづめ」の形。第1関節（指先側）は少しゆるめるだけ。
             指全体が弦に対して垂直に近くなるように。中指〜小指は軽く握り込んで、手のひらから突き出さない。
             親指の腹は人差し指の第一関節の横にそっと当てる
   ・腕の向き：前腕はウクレレの尾側（ボディのおしり側）から、ボディの上の方をほぼ水平に横切って来る（ひじは体の横で約90°）
   ・動き　：前腕は止めたまま、手首の関節（手根関節）を支点に、手首から先だけを動かす（水滴を振り払うようなスナップ）
             ダウン（4弦→1弦）：人差し指の爪の外側（中指側）を、弦に対して30〜45°の角度で当てる。振り始めはゆっくり、
                               弦を通る瞬間がいちばん速い。1弦・2弦側を少し深く（強く）通る
             アップ（1弦→4弦）：指の腹で当てる。外側へ大きく円を描かず、体から離れる向き＋上へまっすぐ引き上げる
             弦の上は一瞬で通り過ぎて（音がバラけず「ジャン」とひとつに）、振り終わりで手首が少しだけ跳ね返る
   ・弾かない拍（空ピッキング）でも手は止めず、弦から少し浮かせて振り続ける
   ========================================================= */
import { fretX, strY, stringZ, add, sub, mul, dot, cross, norm, vlen, DEG } from './geom.js';
import { jointName, THUMB_JOINTS } from './handrig.js';
import { makeThumbModel, solveThumbTo } from './thumb.js';

export const STRUM_X = fretX(16.5);          // 弾く場所：ネックとボディのつなぎ目あたり
export const STRUM_AMP = 0.30;               // 振りの大きさ（ラジアン）

export const STRUM_CFG = {
  wristFlex: 32,                             // 手首は手のひら側へ軽く曲げるだけ（横には曲げない）
  palm: [0, -0.15, -1],                      // 手のひらはボディの方を向く（手の甲は客席側）
  curl:  {1:[38,58,16], 2:[74,100,60], 3:[80,102,60], 4:[84,102,60]},  // 指の曲げ（付け根＝第3・第2・第1関節）。人差し指はかぎづめ
  splay: {1:6, 2:0, 3:-7, 4:-15},            // 指を軽く寄せる（度）
  pivotUp: 120,                              // 腕で振る時の中心：弦から客席側へ何mmか
  rollBias: -12,                             // 構えの時から、前腕を小指側へ少しひねっておく（度）
  armFollow: 0,                              // 弦の上の動きのうち、腕ごと動く割合（0：前腕は止める）
  deviation: 18,                             // 手首を小指側へ倒す角度（度）。ダウンで爪が弦に30〜45°で当たるように決める
  press: 1.3,                                // ダウンで1弦・2弦側を少し深く通る量（mm）
  elbow: [0.84, -0.45, -0.45],               // 手首→ひじの向き：前腕はウクレレの尾側から、ボディの上の方をほぼ水平に横切って来る（ひじは体の横）
};

const R3 = (axis, a, v) => { const k = norm(axis), c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v,c), mul(cross(k,v),s)), mul(k, dot(k,v)*(1-c))); };

// 手首を原点にした「手の中の座標」での関節（1回だけ計算）
// flick：指のしなり（度）。＋で指が伸びる（ダウンで爪が先に当たる）、－で指が丸まる（アップで腹が当たる）
function localHand(rig, flick=0){
  flick = Math.round(flick/3)*3;                             // 3度きざみでキャッシュ
  rig._strumCache ||= new Map();
  if(rig._strumCache.has(flick)) return rig._strumCache.get(flick);
  const palm = [0,-1,0];
  const J = [];
  const radial = norm(sub(rig.rest[jointName(1,1)], rig.rest[jointName(2,1)]));   // 人差し指側
  for(let f=1; f<=4; f++){
    const M = rig.rest[jointName(f,0)], K = rig.rest[jointName(f,1)], T = rig.rest[jointName(f,4)];
    let d0 = norm(sub(T,K));
    // 指を中指の方へ少し寄せる
    const sp = STRUM_CFG.splay[f]*DEG;
    d0 = norm(add(mul(d0, Math.cos(sp)), mul(radial, -Math.sin(sp))));
    const n1 = norm(sub(palm, mul(d0, dot(d0,palm))));
    const L = rig.lengths[f], fl = flick * [0,1,0.55,0.4,0.3][f];
    const c = STRUM_CFG.curl[f].map((v,i)=>v - fl*[0.5,0.3,0.2][i]);
    const pts = [K]; let a = 0, p = K;
    for(let i=0;i<3;i++){ a += c[i]*DEG; p = add(p, add(mul(d0, Math.cos(a)*L[i]), mul(n1, Math.sin(a)*L[i]))); pts.push(p); }
    const axis = norm(cross(d0, n1));
    const Bm = rig.restBasis[jointName(f,0)];
    J.push({name: jointName(f,0), pos: M, fwd: norm(sub(K,M)), dorsal: Bm[1]});
    for(let i=0;i<4;i++){
      const fwd = norm(sub(pts[Math.min(i+1,3)], pts[Math.min(i,2)]));
      J.push({name: jointName(f,i+1), pos: pts[i], fwd, dorsal: cross(fwd, axis), f, i: i+1});
    }
  }
  // 親指：腹を人差し指の第一関節の横（親指側・少し手のひら側）に当てる
  rig.thumbModel ||= makeThumbModel(THUMB_JOINTS.map(n=>rig.rest[n]), THUMB_JOINTS.map(n=>rig.restBasis[n]), palm, rig.rest[jointName(1,1)]);
  const iP = J.find(j=>j.name===jointName(1,2)).pos, iD = J.find(j=>j.name===jointName(1,3)).pos;
  const thTarget = add(add(mul(add(iP,iD),0.5), mul(radial, 9)), mul(palm, 2));
  const th = solveThumbTo(rig.thumbModel, thTarget);
  for(let i=0;i<4;i++){
    const B = rig.thumbModel.restBasis[i], R = th.Rs[i];
    const mv = v => [dot(R[0],v), dot(R[1],v), dot(R[2],v)];
    J.push({name: THUMB_JOINTS[i], pos: th.pts[i], fwd: mv(mul(B[2],-1)), dorsal: mv(B[1])});
  }
  // 弦に当たる点
  //  ダウン：人差し指の爪の外側（中指側）… 第一関節と指先の間の、爪の背中から少し中指側
  //  アップ：指の腹（指先の手のひら側）
  const iDj = J.find(j=>j.name===jointName(1,3)), iTj = J.find(j=>j.name===jointName(1,4));
  const nd = norm(iDj.dorsal);
  const hit = add(add(mul(add(iDj.pos, iTj.pos), 0.5), mul(nd, 6)), mul(radial, -3));
  const pad = add(add(mul(iDj.pos, 0.3), mul(iTj.pos, 0.7)), mul(nd, -5));
  const res = {J, hit, pad, nd};
  rig._strumCache.set(flick, res);
  return res;
}

/* st = {theta: 振りの角度（＋がダウン方向）, lift: 弦から浮かせる量 mm} */
export function rightHandPose(rig, st){
  const {J, hit, pad} = localHand(rig, st.flick || 0);
  // 手の向きは前腕の向きから決める：前腕の延長線から、手のひら側へ wristFlex 度だけ曲げる
  const fa0 = mul(norm(STRUM_CFG.elbow), -1);                         // ひじ→手首
  const P0 = norm(sub(STRUM_CFG.palm, mul(fa0, dot(STRUM_CFG.palm, fa0))));  // 前腕に直交する「手のひら側」
  const a = STRUM_CFG.wristFlex*DEG;
  let F = norm(add(mul(fa0, Math.cos(a)), mul(P0, Math.sin(a))));
  let N = norm(sub(P0, mul(F, dot(P0, F))));
  // 手首を小指側へ少し倒して、手を床の方へ垂らす（爪の背中が振り下ろす向きを向き、弦に斜めに当たる）
  F = norm(R3(N, STRUM_CFG.deviation*DEG, F));
  const U = mul(N,-1), Z = mul(F,-1), Y = U, X = cross(Y,Z);
  const toW = v => add(add(mul(X,v[0]), mul(Y,v[1])), mul(Z,v[2]));
  // θ=0 のとき人差し指の爪が弦のまん中を通るように手首の位置を決める
  const target = [STRUM_X, 0, stringZ(STRUM_X) + 0.4];
  // 手首のしなり（flex：手のひら側へ）と前腕のひねり（roll）を、手首を中心に加える
  const flexA = (st.wrist || 0)*DEG, rollA = ((st.roll || 0) + STRUM_CFG.rollBias)*DEG;
  const bend = v => R3(F, rollA, R3(X, flexA, v));
  const toWb = v => bend(toW(v));
  // 手首の位置は固定（前腕は動かさない）：しなり・ひねりも手首を中心に加わり、手首から先だけが動く
  const bend0 = v => R3(F, STRUM_CFG.rollBias*DEG, v), toW0 = v => bend0(toW(v));
  const W = sub(target, toW0(localHand(rig, 0).hit));            // 指のしなりで手首が動かないように、まっすぐの時の形で決める
  // 手首（手根関節）を支点に回して、指先が弦の上を動く（手首から指先までの距離に合わせて角度を決める）
  const pivot = W;
  // 回す軸：手首から指先へ向かう線と、弦をまたぐ向き（y）の両方に直交する軸
  const hv = sub(target, pivot);
  const ax = norm(cross(hv, [0,1,0])), rHit = vlen(sub(hv, mul(ax, dot(hv, ax))));
  const reach = st.theta * (STRUM_CFG.pivotUp - 4) * 0.72;            // 弦の上で指先が動く幅（mm）。残りは前腕のひねりで
  const follow = reach * STRUM_CFG.armFollow;                          // 腕ごと少しついてくる分
  const th = (reach - follow) / rHit;
  // 弦に当たる点：ダウンは爪の外側、アップは指の腹（動く向きでなめらかに切り替える）
  const vDir = st.v ?? 0, wN = Math.min(1, Math.max(0, (vDir + 0.35)/0.7));
  const contact = add(mul(hit, wN), mul(pad, 1 - wN));
  // 指先の高さ（弦からの距離）の合わせ方：手ごと動かすと手首まで動いてしまうので、
  // 手首を中心にもう少しだけ曲げ伸ばしして合わせる（手首の位置は動かない）
  const ax2 = norm(cross(hv, [0,0,1]));                          // 回すと指先がおもに前後（z）に動く軸
  const zOf = (phi) => { const p = sub(add(W, toWb(contact)), pivot);
    return add(pivot, R3(ax2, phi, R3(ax, th, p))); };
  const zWant = (q, phi) => {
    // 弦の上（4本の幅）では指先を弦の面に合わせ、外側では弧を描いて自然に弦から離れる
    const onStr = 1 - Math.min(1, Math.max(0, (Math.abs(q[1]) - 12)/14));
    // ダウンは1弦・2弦側（+y）を少し深く通る（強く当たる）
    const press = vDir > 0 ? STRUM_CFG.press * vDir * Math.min(1, Math.max(0, (q[1] + 4)/16)) : 0;
    const surf = stringZ(STRUM_X) + 0.4 - press;
    return onStr*surf + (1-onStr)*Math.max(surf, q[2] - (phi ? 0 : 0)) + st.lift;
  };
  let phi = 0;
  for(let it=0; it<3; it++){                                     // 2〜3回で十分に合う
    const q = zOf(phi), want = it === 0 ? zWant(q, 0) : zWant(zOf(0), 0);
    const r = vlen(sub(sub(q, pivot), mul(ax2, dot(sub(q, pivot), ax2))));
    const dz = want - q[2];
    // ax2 まわりに phi 回すと、指先の z はおよそ r*phi*(向き) だけ動く
    const zr = cross(ax2, sub(q, pivot))[2] / Math.max(1e-6, r);
    if(Math.abs(zr) < 1e-3) break;
    phi += dz / (r * zr);
  }
  const rotAll = v => R3(ax2, phi, R3(ax, th, v));
  const place = p => add(add(pivot, rotAll(sub(p, pivot))), [0, follow, 0]);
  const dir = v => rotAll(v);
  const out = [];
  const Wp = place(W);
  out.push({name:'wrist', pos: Wp, fwd: dir(bend(F)), dorsal: dir(bend(U))});
  // 見えている腕は手首の少し先までなので、前腕は手首からそのまま伸ばす
  // （手首で強く折ると、短い腕の皮膚がねじれてギザギザに見えるため）。少しだけ前腕の向きに寄せる
  // 前腕はあまり動かない（手首から先が主に動く）
  const dirArm = v => v;                                          // 前腕は動かさない（手首から先だけが回る）
  const fa = norm(add(mul(dirArm(F), 0.8), mul(dirArm(fa0), 0.2)));
  const Ur = dirArm(R3(F, rollA*0.8, U));                                // 前腕の回転（回内・回外）なので前腕もひねる
  out.push({name:'forearm', pos: Wp, fwd: fa, dorsal: sub(Ur, mul(fa, dot(Ur,fa)))});
  for(const j of J) out.push({name: j.name, pos: place(add(W, toWb(j.pos))), fwd: norm(dir(toWb(j.fwd))), dorsal: norm(dir(toWb(j.dorsal)))});
  return {joints: out, tip: place(add(W, toWb(contact)))};
}

/* ---------- ストロークのパターン（8分音符8つで1小節） ---------- */
export const PATTERNS = [
  {name:'ダウン4つ',             p:'D-D-D-D-', tip:'1拍に1回、上から下へ。まずはここから'},
  {name:'8ビート（ダウン・アップ）', p:'DUDUDUDU', tip:'下・上・下・上。手は止めずに振り子のように'},
  {name:'カリプソ（ハワイアン定番）', p:'D-DU-UDU', tip:'「ダン・ダダ・ンダ・ダダ」。空振りのところも手は振り続けます'},
  {name:'ゆったりバラード',         p:'D--UD-DU', tip:'1拍目と3拍目をしっかり。ゆっくりのテンポで'},
];

/* ---------- 人間らしい振り方 ----------
   研究メモ（ギターのストロークの観察・動作解析の報告より）
   ・腕だけで振らない：ひじを支点にした腕の振り＋前腕のひねり（回内・回外）＋手首のしなりの組み合わせ
   ・手首は腕より少し遅れてついてくる（ムチのように、腕が先・手先があと）
   ・弦を通るところがいちばん速く、上と下の折り返しはゆっくり
   ・ダウンは全部の弦をしっかり、アップは1〜3弦だけ軽く（振り幅が小さい）
   ・指先がしなる：ダウンでは指が少し伸びて爪が先に当たり、アップでは丸まって指の腹が当たる
   ・1拍目は少し大きく（アクセント）、空振りは小さく浮かせる
   ・毎回まったく同じではない：振り幅・タイミングがほんの少しずつばらつく */
const hash = k => { const x = Math.sin(k*127.1 + 311.7)*43758.5453; return x - Math.floor(x); };
function strokeAmp(k, pattern){
  const n = pattern.length, slot = ((k%n)+n)%n;
  const ghost = pattern[slot] === '-', up = (k & 1) === 1;
  let a = 1;
  if(slot === 0) a *= 1.12;                          // 1拍目のアクセント
  else if(slot % 2 === 0) a *= 1.0;
  if(up) a *= 0.82;                                  // アップは小さめ
  if(ghost) a *= 0.72;                               // 空振りはさらに小さく
  a *= 1 + (hash(k) - 0.5)*0.12;                     // 少しのばらつき
  return a;
}
const smooth = t => t*t*(3-2*t);

// 時刻 → 右手の振り（8分音符の位置 phase を渡す）
export function strumState(phase, pattern){
  const k = Math.floor(phase), f = phase - k;
  // その半周期の振り幅（となりの振りとなめらかにつなぐ）
  const A = STRUM_AMP * (strokeAmp(k, pattern) + (strokeAmp(k+1, pattern) - strokeAmp(k, pattern))*smooth(f));
  // 振り始めはゆっくり、弦を通る瞬間（phase が整数）がいちばん速い：sin をさらに「締めた」形。
  // 弦の上を一瞬で通るので、音がバラけず「ジャン」とひとつになる
  const SNAP = 2.2;
  const theta = A * Math.tanh(SNAP*Math.sin(Math.PI*phase))/Math.tanh(SNAP);
  // 手首は腕より遅れてしなる（位相を少し遅らせる）
  const lag = 0.14;
  // 振り終わりの跳ね返り：弦を通ったあと、手首が少しだけ行きすぎて戻る（力が抜けている感じ）
  const kc = Math.round(phase), after = phase - kc, dirC = (kc & 1) ? -1 : 1;
  const rebound = after > 0 ? 5 * dirC * (A/STRUM_AMP) * Math.exp(-after*7) * Math.sin(after*Math.PI*3.2) : 0;
  const wrist = -16 * (A/STRUM_AMP) * Math.sin(Math.PI*(phase - lag)) - rebound;
  // 前腕のひねり：甲を軸にした振りに合わせて、指先が同じ向きに動くようにひねる
  const roll = -12 * (A/STRUM_AMP) * Math.sin(Math.PI*(phase - lag*0.5));
  // 指のしなり：動く向き（速度）に合わせて。弦を通る少し前から
  const v = Math.cos(Math.PI*(phase + 0.06));               // ＋で下向き（ダウン）に動いている
  const flick = v > 0 ? 12*v : 11*v;                          // アップは指を丸めて、指の腹で当てる
  // アップ：弦を通ったら（4弦側へ抜けたら）外へ大きく回らず、体から離れる向き＋上へまっすぐ引き上げる
  const upLift = v < 0 && theta < 0 ? 11 * Math.pow(Math.min(1, -theta/STRUM_AMP), 1.3) : 0;
  // 空振りは手を浮かせる
  const kk = Math.round(phase), d = phase - kk;
  const ghost = pattern[((kk%pattern.length)+pattern.length)%pattern.length] === '-';
  const bump = Math.abs(d) < 0.5 ? Math.pow(Math.cos(Math.PI*d), 2) : 0;
  return {theta, lift: (ghost ? 13*bump : 0) + upLift, wrist, roll, flick, v};
}

// 弾いていない時：力を抜いて、ゆっくり呼吸するように少しだけ揺れる
export function idleState(t){
  return {theta: -STRUM_AMP*0.9 + 0.025*Math.sin(t*1.1), lift: 7 + 1.5*Math.sin(t*0.7+1), wrist: 4 + 2*Math.sin(t*0.9), roll: 0, flick: -4, v: 0};
}
