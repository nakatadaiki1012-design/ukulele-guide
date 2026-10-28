/* =========================================================
   コード → 手の形（逆運動学）
   骨の長さ・指の付け根の位置は、手の3Dモデルの実寸をそのまま使う
   ========================================================= */
import { fretX, halfW, strY, FRET_TOP, NECK_BACK_Z, stringZ,
         add, sub, mul, dot, cross, vlen, norm, lerp, lerp3, DEG } from './geom.js';
import { jointName, THUMB_JOINTS } from './handrig.js';
import { makeThumbModel, solveThumb, neckSD } from './thumb.js';

// 指の太さ（半径・付け根〜指先）…弦に触れないかの判定用
const RAD = {1:[9.6,8.6,7.6,7.0], 2:[9.9,8.9,7.8,7.1], 3:[9.3,8.4,7.4,6.8], 4:[8.2,7.4,6.6,6.1]};
// 第一関節は第二関節の約0.75倍だけ曲がる（小指は約0.6倍）…計測研究の値
const COUPLE = {1:0.75, 2:0.75, 3:0.75, 4:0.6};
// モデルの「指先の関節(tip)」から実際の指先の皮膚までは約11mm（実測）。
// 計算では、指先の丸みの中心（tip関節から8.5mm先）を「指の腹の点」として、それを弦の上に置く
const PAD_EXT = 8.5, PAD_R = 4.8;

/* 手の向き：手のひらはネックの裏側にあり、親指はネックの裏の4弦(G)側に添える。
   指の付け根は1弦(A)側の縁の外にあり、指はそこからネックを回り込んで、斜めに弦を押さえる。
   前腕は体の側（ネックの裏・床側・ボディ側）から来て、手首で少し曲がる */
export const HAND_CFG = {
  F: [-0.30, 0.10, 1.0],  N: [0.10,-1, 0.25],     // ふつうのコード（F：手首→指の付け根 / N：手のひらの向き）
  Fb:[-0.25, 0.20, 1.0],  Nb:[0.10,-1, 0.10],     // セーハ
  yK: 36, zK: -12, yKb: 40, zKb: -10,             // 人差し指の付け根の位置
  arm: [0.45, 0.50, -0.74],                       // 手首→肘の向き
  tipTilt: 28,                                    // 指先は真上から何度くらい傾けて当てるか
  barreRise: -10, barreRiseW: 0.02, barreEdge: 12,   // セーハ：人差し指の付け根の高さ（指板の面 z=0 から。大きいほど指板に近い）と、ネックのふちからの距離
  headShift: 24,                                   // 手（指の付け根）をヘッド側へずらす量(mm)。大きいほどネックのヘッド側が手のひらに乗り、指がのびる
  barrePole: [50, -18],                             // セーハの第二関節の折れる向き（A側へ・上へ）。A側が大きいほど、指が弦に沿って寝る
  barreReach: 0.6, barreReachW: 0.08,                // セーハ：付け根と腹の線の入口の距離を、骨の長さのこの割合以上にする
  barreTilt: 0.5,                                  // セーハで人差し指を弦に対して斜めに寝かせる度合い（0＝弦に垂直にまっすぐ、1＝弦に沿って寝かせる）
  palmGap: [0, 20, 32, 42], palmGapW: 0.6, indexNear: 10, indexNearW: 0.5,        // 指の付け根（人差し指→小指）がネックの表面から離れていてほしい距離(mm)。小指側ほど大きく＝手のひらが斜めになって、ネックから離れる
  thumbY: -14, thumbPeek: 12, thumbPeekZ: -6,                     // 親指の腹の位置（ネック裏のやや1弦G寄り）と、先をネックの上の縁から何mmのぞかせるか
};
function handFrame(barre, prm){
  const C = HAND_CFG;
  let F = norm(barre ? C.Fb : C.F);                                      // 手首→指の付け根
  let N = barre ? C.Nb : C.N;
  N = norm(sub(N, mul(F, dot(N,F))));                                   // 手のひらの向き（ネック側）
  // 手の向きの微調整（シミュレーションで決める）：ひねり・左右の傾き・ネックまわりの回転
  const R = (axis, a, v) => { const k = norm(axis), c = Math.cos(a), s = Math.sin(a);
    return add(add(mul(v,c), mul(cross(k,v),s)), mul(k, dot(k,v)*(1-c))); };
  if(prm){
    N = R(F, prm.roll*DEG, N);
    F = R(N, prm.yaw*DEG, F);
    F = R([1,0,0], prm.pitch*DEG, F); N = R([1,0,0], prm.pitch*DEG, N);
  }
  const U = mul(N,-1);                                                  // 手の甲の向き
  // 手首の関節の座標軸（WebXR：-Zが指先、+Yが手の甲）
  const Z = mul(F,-1), Y = U, X = cross(Y,Z);
  return {F, N, U, X, Y, Z};
}
const toWorld = (H, W, o) => add(W, add(add(mul(H.X,o[0]), mul(H.Y,o[1])), mul(H.Z,o[2])));

function chain2(L, th, p2, p3){
  let a=th, x=0, y=0; const out=[[0,0]];
  [[L[0],0],[L[1],p2],[L[2],p3]].forEach(([l,da])=>{ a+=da; x+=l*Math.cos(a); y+=l*Math.sin(a); out.push([x,y]); });
  return out;
}

/* 1本の指：第二関節の曲げ角を二分探索で決め、第一関節の連動比率をいくつか試して
   「指先が真上から当たる」「他の弦に触れない」「関節が無理な角度にならない」ものを選ぶ */
/* 待っている指：力を抜いた形（つけ根 約40°・第二関節 約50°）を基本に、
   「弦に触れない高さ」「だいたい自分のフレット・弦の上」を保つように、曲げ角を少しだけ変える。
   決まった点に指先を合わせないので、近すぎる点に合わせて「く」の字に縮こまることがない */
function relaxedFinger(f, Lbone, K, T, H, lift, others=[]){
  const R = RAD[f], c = COUPLE[f];
  const L = [Lbone[0], Lbone[1], Lbone[2]+PAD_EXT];
  const d = sub(T,K); let e = sub(d, mul(H.N, dot(d,H.N)));             // つけ根 → 待つ場所 の向き（手のひらの向きと直角な成分）
  e = vlen(e) > 1e-6 ? norm(e) : norm(sub(H.F, mul(H.N, dot(H.F,H.N))));
  const toW = ([u,v]) => add(K, add(mul(e,u), mul(H.N,v)));
  let best = null;
  for(let th=-36; th<=30; th+=6) for(let p2=20; p2<=100; p2+=5){
    const pts = chain2(L, th*DEG, p2*DEG, c*p2*DEG).map(toW);
    const pad = pts[3];
    let cost = ((th+12)*(th+12) + (p2-55)*(p2-55))/900 + Math.max(0, p2-82)*Math.max(0, p2-82)/260;   // 楽な形（少しそらせてから、第二関節で曲げる）からの違い。深く曲げすぎない
    const need = stringZ(pad[0]) + PAD_R + lift;                           // 指の腹の高さ（弦から lift mm）
    cost += Math.pow(Math.max(0, need - pad[2]), 2)*0.6 + Math.pow(Math.max(0, pad[2] - need - 6), 2)*0.03;
    cost += Math.pow((pad[0]-T[0])/12, 2)*0.8 + Math.pow((pad[1]-T[1])/14, 2)*0.5;
    for(let s=0;s<3;s++) for(let t=0;t<=1.001;t+=0.25){                   // 弦に触れない
      const P = lerp3(pts[s],pts[s+1],t), r = lerp(R[s],R[s+1],t);
      if(Math.abs(P[1]) < halfW(P[0]) + r*0.5){ const cl = P[2]-r-(stringZ(P[0])+1.0); if(cl<0) cost += cl*cl*2; }
    }
    for(const o of others) cost += fingerHit(f, pts, o.f, o.pts)*2;   // 押さえている指にかぶさらない
    if(!best || cost < best.cost) best = {cost, pts};
  }
  const out = padToTip(best.pts, Lbone[2]); out.pen = 0;
  return out;
}

/* 1本の指：第二関節の曲げ角を二分探索で決め、第一関節の連動比率をいくつか試して
   「指先が真上から当たる」「他の弦に触れない」「関節が無理な角度にならない」ものを選ぶ */
function solveFinger(f, Lbone, K, T, H, kind, others=[]){
  const R = RAD[f];
  const L = [Lbone[0], Lbone[1], Lbone[2]+PAD_EXT];
  // 指を曲げる面：ふつうは手のひらの向き(N)を含む面。ほかの指とぶつかる時は、つけ根→指先の線を軸に面を少しひねる
  // （指を少し横に開いて／閉じて曲げる。第二関節が隣の指の上にかぶさらないように）（ギター・ハンドガイドと同じ）
  const ax = norm(sub(T,K)), rots = kind==='press' && others.length ? [0,-12,12,-24,24,-36,36] : [0];
  let best = null;
  for(const rot of rots){
  const c0 = Math.cos(rot*DEG), s0 = Math.sin(rot*DEG);
  const Nr = rot ? add(add(mul(H.N,c0), mul(cross(ax,H.N),s0)), mul(ax, dot(ax,H.N)*(1-c0))) : H.N;
  const d = sub(T,K), b = dot(d,Nr);
  let e = sub(d, mul(Nr,b)); const a = vlen(e); e = a>1e-6 ? mul(e,1/a) : H.F;
  const tgt = Math.hypot(a,b), tAng = Math.atan2(b,a);
  const toW = ([u,v]) => add(K, add(mul(e,u), mul(Nr,v)));
  const cs = kind==='press' ? [0.4,0.5,0.6,0.7,0.8,0.9,1.0] : [COUPLE[f]];
  for(const c of cs){
    const lenAt = p=>{ const q=chain2(L,0,p,c*p)[3]; return Math.hypot(q[0],q[1]); };
    const maxP = 112*DEG; let p2;
    if(tgt >= lenAt(0)) p2 = 0;
    else if(tgt <= lenAt(maxP)) p2 = maxP;
    else { let lo=0, hi=maxP; for(let i=0;i<28;i++){ const m=(lo+hi)/2; if(lenAt(m)>tgt) lo=m; else hi=m; } p2=(lo+hi)/2; }
    const q = chain2(L,0,p2,c*p2)[3];
    const th = tAng - Math.atan2(q[1],q[0]);
    const pts = chain2(L,th,p2,c*p2).map(toW);
    let pen = 0;
    const dd = norm(sub(pts[3],pts[2]));
    if(kind==='press'){
      const ang = Math.acos(Math.min(1,Math.max(-1,-dd[2])))/DEG;      // 指先は少し斜めに立てて当てる
      pen += Math.max(0, Math.abs(ang-HAND_CFG.tipTilt)-10)*0.15;
      if(dd[1] > 0.35) pen += (dd[1]-0.35)*20;                          // 手の方へ折り返すのは不自然
    }
    const p1 = norm(sub(pts[1],pts[0]));
    const mcp = Math.atan2(dot(p1,H.N), dot(p1,H.F))/DEG;              // 付け根の関節（反らすのは苦手）
    if(mcp < -5) pen += (-5-mcp)*1.2;
    if(mcp > 90) pen += (mcp-90)*0.5;
    if(c*p2/DEG > 88) pen += (c*p2/DEG-88)*0.3;
    pen += Math.abs(c-COUPLE[f])*2;
    for(let s=0;s<3;s++) for(let t=0;t<=1.001;t+=0.25){                 // 他の弦に触れないか
      if(kind!=='hover' && s===2 && t>0.3) continue;
      const P = lerp3(pts[s],pts[s+1],t), r = lerp(R[s],R[s+1],t);
      if(Math.abs(P[1]) < halfW(P[0]) + r*0.5){ const cl = P[2]-r-(stringZ(P[0])+0.6); if(cl<0) pen += -cl*1.5; }
    }
    // 先に形を決めた（押さえている）指にかぶさらない。面をひねるほど少し不自然なので、少しだけコストを足す
    if(rot) pen += Math.abs(rot)*0.03;
    for(const o of others) pen += fingerHit(f, pts, o.f, o.pts);
    if(!best || pen<best.pen) best = {pen, pts};
  }
  }
  const out = padToTip(best.pts, Lbone[2]); out.pen = best.pen;
  return out;
}
// 2本の指がどれくらい重なっているか（重なった分の2乗）。付け根どうしは、もともと軽く触れ合っているので見ない
function fingerHit(f, A, g, B){
  let h = 0;
  for(let a=1;a<3;a++) for(let b=1;b<3;b++){
    const d = segDist(A[a],A[a+1],B[b],B[b+1]);
    const r = 0.84*((RAD[f][a]+RAD[f][a+1])/2 + (RAD[g][b]+RAD[g][b+1])/2) - 2.5;
    if(d < r) h += (r-d)*(r-d)*0.5;
  }
  return h;
}
// 「指の腹の点」→ モデルの tip 関節の位置に戻す
function padToTip(pts, l3){
  return [pts[0], pts[1], pts[2], add(pts[2], mul(norm(sub(pts[3],pts[2])), l3))];
}

// 2本の線分のいちばん近い距離
function segDist(p1,q1,p2,q2){
  const d1 = sub(q1,p1), d2 = sub(q2,p2), r = sub(p1,p2);
  const a = dot(d1,d1), e = dot(d2,d2), f = dot(d2,r), c = dot(d1,r), b = dot(d1,d2);
  const den = a*e - b*b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b*f - c*e)/den)) : 0;
  let t = (b*s + f)/e;
  if(t < 0){ t = 0; s = Math.min(1, Math.max(0, -c/a)); }
  else if(t > 1){ t = 1; s = Math.min(1, Math.max(0, (b-c)/a)); }
  return vlen(sub(add(p1, mul(d1,s)), add(p2, mul(d2,t))));
}

function ik3(A, C, l1, l2, pole){
  const d = sub(C,A); let dist = vlen(d);
  dist = Math.min(Math.max(dist, Math.abs(l1-l2)+0.01), l1+l2-0.01);
  const ax = norm(d), pv = sub(pole,A);
  const perp = norm(sub(pv, mul(ax, dot(pv,ax))));
  const ca = (l1*l1+dist*dist-l2*l2)/(2*l1*dist), sa = Math.sqrt(Math.max(0,1-ca*ca));
  return add(A, add(mul(ax,l1*ca), mul(perp,l1*sa)));
}

// セーハ：人差し指を弦に対して斜めに寝かせて、指の腹と第一関節の側面で何本もまとめて押さえる。
// 付け根（K）は1弦A側のふちの外にあり、そこから「斜めに」指がのびて、G側の端の弦の少し先まで届く。
// 弦に垂直にまっすぐ立てたり、途中で折り返したりすると、1本の指で全部の弦を押さえているようには見えない。
// 指の腹の線（D→T）はフレットの上で弦をまたぐ向きから tilt だけ寝かせる（0＝弦に垂直、1＝弦と平行）
function solveBarre(L, K, barre, H){
  const x = fretX(barre.fret) - 6;
  const zc = FRET_TOP + 7.2;                                  // 指の中心の高さ（指の腹で弦を押し下げる）
  const yG = strY(barre.from, x), yA = strY(barre.to, x);      // 押さえる範囲の端の弦（from＝G側、to＝A側）
  const tilt = Math.min(1, Math.max(0, HAND_CFG.barreTilt));
  const pad = L[2] + PAD_EXT;                                  // 指の腹の線の長さ
  // 腹の線：G側の端（先端 T）から、A側へ向かう
  const T = [x - 1.5, yG - 3, zc];
  const wide = Math.abs(yA - yG) + 6;                          // 弦をまたぐ幅
  const along = Math.min(pad, wide / Math.max(0.2, 1 - tilt*0.6));
  const dy = Math.min(wide, along*(1 - tilt*0.7)), dx = Math.sqrt(Math.max(0, along*along - dy*dy)) * 0.55 * tilt;
  const D = [T[0] + dx*0.5 + 0.7, T[1] + dy*0.9, zc + 0.4];
  // 第二関節：付け根（K）から腹の線の入口（D）まで、骨（L[0]＋L[1]）が「く」の字に折れすぎずに届く位置。
  // 付け根が近すぎる（骨が余る）時は、余った分だけ、第二関節を指板の面に沿って（弦の外側へ）はらんで逃がす
  const total = L[0] + L[1], reach = vlen(sub(D, K));
  let P;
  if(barre.to-barre.from+1 >= 3 && reach > total*0.8) P = [(K[0]+D[0])/2 + 2, (K[1]+D[1])/2, zc + 1.0 + Math.max(0, (K[2]-zc)*0.05)];
  else {
    // 骨が余る時：付け根→第二関節→D の折れ曲がりを、曲げ角が 100° を超えない範囲に収める
    // （第二関節を、K と D の中間から、指板の上へ「少し」押し上げた位置に置く。押し上げる量は余りの長さから決める）
    const slack = Math.max(0, total - reach);
    const lift = Math.min(slack*0.45, 24);
    // 第二関節（P）は、指板の上へそびえ立たせず、A弦の外側・弦と同じ高さの所に置く（指の腹〜中ほどが弦に沿って寝る）。
    // そのため折れ曲がりの向き（pole）は、指板の外（A側）へ。barrePole = [A側へ, 上へ]
    const bp = HAND_CFG.barrePole;
    P = ik3(K, D, L[0], L[1], add(mul(add(K,D),0.5), [0, bp[0] + lift*0.2, bp[1]]));
    // 折れすぎ（第二関節の曲がりが 105° 超）の時は、第二関節を D の方へ寄せて曲がりをゆるめる
    const a1 = norm(sub(P,K)), a2 = norm(sub(D,P)), bend = Math.acos(Math.max(-1, Math.min(1, dot(a1,a2))))/DEG;
    if(bend > 105){
      const t = Math.min(0.6, (bend-105)/70);
      P = add(mul(P, 1-t), mul(add(mul(K, 0.35), mul(D, 0.65)), t));
    }
  }
  return padToTip([K, P, D, T], L[2]);
}

/* 手全体の形を作って「どれくらい無理があるか（コスト）」を返す */
function buildHand(chord, rig, prm, thumbStart){
  const barre = chord.barre;
  const fullBarre = !!barre && (barre.to-barre.from+1) >= 3;
  const H = handFrame(fullBarre, prm);
  const used = {};
  chord.fingers.forEach((f,s)=>{ if(!f) return; (used[f] ||= {strings:[], fret:chord.frets[s]}).strings.push(s); });
  // 指先の位置（フレットのすぐ手前。同じフレットに何本か並ぶときは斜めにずらす）
  const tipX = {}, byFret = {};
  for(const f in used){ if(barre && +f===1) continue; (byFret[used[f].fret] ||= []).push(+f); }
  for(const fr in byFret){
    const list = byFret[fr].sort((a,b)=>a-b), n = list.length;
    // 指先の前後位置もシミュレーションで調整（フレットとフレットの間に収める）。
    // 同じフレットに何本か並ぶときは、指の順番どおり斜めに並べる（人差し指がいちばんナット寄り）
    // 離れた弦を押さえる時ほど大きくずらす（遠い弦へのびる指が、もう1本の指先の上を横切らないように）
    const strs = list.map(f=>Math.min(...used[f].strings)), span = strs.length > 1 ? Math.max(...strs) - Math.min(...strs) : 0;
    const hi = fretX(+fr) - 2.5, lo = fretX(+fr-1) + (+fr === 1 ? 6 : 1.5), gap = Math.min(span >= 3 ? 13 : 8, (hi-lo)/Math.max(1,n-1));
    const xs = list.map((f,i)=> fretX(+fr) - 4.5 - (n-1-i)*gap + (prm['dx'+f] || 0));
    for(let i=n-1;i>=0;i--){ xs[i] = Math.min(xs[i], i<n-1 ? xs[i+1]-gap : hi); }
    for(let i=0;i<n;i++){ xs[i] = Math.max(xs[i], i>0 ? xs[i-1]+gap : lo); }
    list.forEach((f,i)=>{ tipX[f] = Math.min(hi, xs[i]); });
  }
  if(barre) tipX[1] = fretX(barre.fret) - 6;

  // 指の付け根（ナックル）の並びはモデルの実寸。指先に合わせて手全体を前後にずらす
  const kRest = f => toWorld(H, [0,0,0], sub(rig.rest[jointName(f,1)], rig.rest[jointName(1,1)]));
  let anc = 0, cnt = 0;
  for(const f in tipX){ anc += tipX[f] - kRest(+f)[0]; cnt++; }
  anc = cnt ? anc/cnt : fretX(1)-2;
  anc = Math.max(4, anc - HAND_CFG.headShift);          // ネックのヘッド側（ナット寄り）を手のひらに置く：手全体をヘッド側へずらし、指をのばして届かせる
  // 手首の位置：人差し指の付け根が [anc, yK, zK] に来るように
  const kIdx = toWorld(H, [0,0,0], rig.rest[jointName(1,1)]);
  const W = sub([anc, prm.yK, prm.zK], kIdx);
  const K = {}, M = {};
  for(let f=1; f<=4; f++){ K[f] = toWorld(H, W, rig.rest[jointName(f,1)]); M[f] = toWorld(H, W, rig.rest[jointName(f,0)]); }

  let cost = 0; const parts = {};
  const addc = (k,v) => { parts[k] = (parts[k]||0)+v; cost += v; };
  const fingers = {};
  // 押さえる指から先に形を決め、浮かせて待つ指は、押さえている指をよけて置く（ギター・ハンドガイドと同じ）
  const order = [1,2,3,4].sort((a,b)=>(used[a]||(barre&&a===1) ? 0 : 1) - (used[b]||(barre&&b===1) ? 0 : 1) || a-b);
  const pressed = () => Object.entries(fingers).filter(([,v])=>v.mode!=='hover').map(([g,v])=>({f:+g, pts:v.pts}));
  for(const f of order){
    const L = rig.lengths[f];
    let pts, mode, string = null, T;  // T = 指の腹の目標点
    if(barre && f===1){
      mode = 'barre'; string = barre.from; pts = solveBarre(L, K[1], barre, H);
    } else if(used[f]){
      mode = 'press'; string = Math.min(...used[f].strings);
      const x = tipX[f];
      T = [x, strY(string,x)+1.0, FRET_TOP + 0.35 + PAD_R];
      pts = solveFinger(f, L, K[f], T, H, 'press', pressed());
      addc('pen'+f, pts.pen);
      // 届かない／縮こまりすぎ：指先が目標からずれた分
      const pd = vlen(sub(add(pts[2], mul(norm(sub(pts[3],pts[2])), L[2]+PAD_EXT)), T));
      addc('reach'+f, pd*pd*0.5);
    } else {
      mode = 'hover';   // 使わない指：力を抜いた形のまま、弦の少し上に浮かせる（押さえている指にかぶさらない）
      const x = K[f][0]+2;
      T = [x, f===4 ? 20 : 12, FRET_TOP + PAD_R + (f===4 ? 10 : 9)];
      // セーハの間：残りの指は人差し指の下に丸まって拳のようにならないよう、人差し指のすぐ脇から、
      // A側へ向かって指1本ぶんずつ離して扇のように置く（重ならないように）
      if(barre && f>=2){
        const bx = fretX(barre.fret) - 6;
        T = [bx + 3 + (f-2)*5.5, 20 + (f-2)*7, FRET_TOP + PAD_R + 12 + (f-2)*2.5];
      }
      // 押さえる指が1本もない（開放弦だけの）コードは、指を弦のすぐ上に添える（宙に浮かせない）。
      // 押さえる指がある時は、その指の邪魔にならない高さに浮かせる
      const idle = !barre && Object.keys(used).length === 0;
      pts = relaxedFinger(f, L, K[f], T, H, idle ? 2 + (f-1)*0.8 : (f===4 ? 7 : 5), pressed());
    }
    const axis = norm(cross(sub(pts[3],pts[0]), H.N));
    fingers[f] = {mode, pts, string, axis};
  }
  // 指どうしがぶつからない（重なると指がくっついて見える）
  for(let f=1; f<=4; f++) for(let g=f+1; g<=4; g++){
    const A = fingers[f].pts, B = fingers[g].pts;
    for(let a=0;a<3;a++) for(let b=0;b<3;b++){
      // 隣の指の付け根どうしは、もともと軽く触れ合っているので少しだけゆるくする
      const base = (a===0 && b===0 && g===f+1);
      const d = base ? segDist(add(A[0], mul(sub(A[1],A[0]),0.35)), A[1], add(B[0], mul(sub(B[1],B[0]),0.35)), B[1])
                     : segDist(A[a],A[a+1],B[b],B[b+1]);
      const r = (base ? 0.78 : 0.84)*((RAD[f][a]+RAD[f][a+1])/2 + (RAD[g][b]+RAD[g][b+1])/2) - 2.5;  // 指どうしは少し押し合ってもよい
      if(d < r) addc('collide'+f+g, (r-d)*(r-d)*1.8);
    }
  }
  // 音がよく鳴るのはフレットのすぐ近く
  for(const f in tipX) if(!(barre && +f===1)) cost += (fretX(used[f].fret) - tipX[f]) * 0.06;

  // 手のひら・手首がネックにめり込まない
  const palmPts = [];
  for(let f=1; f<=4; f++){ palmPts.push([K[f],9], [M[f],11], [mul(add(K[f],M[f]),0.5),12]); }
  palmPts.push([W,20], [toWorld(H, W, rig.rest[THUMB_JOINTS[0]]),13]);
  for(const [p,r] of palmPts){ const g = neckSD(p); if(g < r) cost += (r-g)*(r-g)*1.5; }
  // 手のひら（指の付け根）をネックから離す：小指側ほど大きく。指をのばして、斜めから押さえる形になる
  for(let f=1; f<=4; f++){ const g = neckSD(K[f]), want = HAND_CFG.palmGap[f-1]; if(g < want) cost += (want-g)*(want-g)*HAND_CFG.palmGapW; }
  // セーハ：付け根（K）から腹の線の入口までの距離が、人差し指の骨（付け根側の2本ぶん）に対して近すぎると、
  // 余った骨が「く」の字に折れて第二関節が指板の上に飛び出す。骨の長さの6割以上は離しておく
  if(barre){
    const Ld = rig.lengths[1], bx = fretX(barre.fret) - 6, gy = strY(barre.from, bx);
    const near = vlen(sub(K[1], [bx, gy, FRET_TOP + 7]));
    const want = (Ld[0] + Ld[1]) * HAND_CFG.barreReach;
    if(near < want) cost += (want-near)*(want-near)*HAND_CFG.barreReachW;
  }
  // セーハ：人差し指を指板の面に近い位置から寝かせて当てる（付け根が低いと、指が弦の上へ「立ち上がる」形になる）
  if(barre){
    const k = K[1], hw = halfW(k[0]);
    const dz = Math.max(0, HAND_CFG.barreRise - (k[2] - 0)), over = Math.max(0, Math.abs(k[1]) - hw - HAND_CFG.barreEdge);
    cost += (dz*dz*HAND_CFG.barreRiseW) + over*over*0.15;
  }
  // 人差し指の付け根は、ネックについてもよい（ここを支点に、手が小指側へ斜めに開く）。少し近い方が楽な形として好む
  { const g = neckSD(K[1]); if(g > HAND_CFG.indexNear) cost += (g-HAND_CFG.indexNear)*(g-HAND_CFG.indexNear)*HAND_CFG.indexNearW; }
  // 手首の曲がりすぎ（前腕の向きとの角度）
  const bend = Math.acos(Math.max(-1, Math.min(1, dot(H.F, mul(norm(HAND_CFG.arm),-1)))))/DEG;
  if(bend > 30) cost += (bend-30)*(bend-30)*0.02;

  // 親指：関節が自然に曲がる範囲の中で、ネックの裏に軽く当たる形をさがす（thumb.js）
  rig.thumbModel ||= makeThumbModel(THUMB_JOINTS.map(n=>rig.rest[n]), THUMB_JOINTS.map(n=>rig.restBasis[n]), [0,-1,0]);
  const toWd = v => toWorld(H, [0,0,0], v);
  const th = solveThumb(rig.thumbModel, v=>toWorld(H, W, v), toWd,
                        { xTarget: (K[1][0]+K[2][0])/2, yTarget: HAND_CFG.thumbY, peek: HAND_CFG.thumbPeek, peekZ: HAND_CFG.thumbPeekZ, start: thumbStart });
  addc('thumb', th.cost);
  return {cost, parts, H, W, K, M, fingers, tipX, th, toWd, barre};
}

// 手の向き・位置を少しずつ変えて、いちばん無理のない持ち方をさがす
const PRM_STEP = {pitch:8, yaw:8, roll:8, yK:5, zK:5, dx1:4, dx2:4, dx3:4, dx4:4};
const PRM_LIM  = {pitch:[-45,45], yaw:[-35,35], roll:[-35,35], yK:[18,64], zK:[-42,2], dx1:[-24,4], dx2:[-24,4], dx3:[-24,4], dx4:[-24,4]};
const poseCache = new Map();
function localSearch(chord, rig, prm, pressing, scales){
  let best = buildHand(chord, rig, prm), thStart = best.th.ang;
  for(const scale of scales){
    let improved = true, guard = 0;
    while(improved && guard++ < 12){
      improved = false;
      for(const k in PRM_STEP) for(const sgn of [-1,1]){
        if(k[0]==='d' && k[1]==='x' && !pressing.has(+k[2])) continue;
        const v = Math.min(PRM_LIM[k][1], Math.max(PRM_LIM[k][0], prm[k] + sgn*PRM_STEP[k]*scale));
        if(v === prm[k]) continue;
        const cand = {...prm, [k]: v};
        const r = buildHand(chord, rig, cand, thStart);
        if(r.cost < best.cost - 1e-4){ best = r; prm = cand; thStart = r.th.ang; improved = true; }
      }
    }
  }
  best.prm = prm;
  return best;
}
function optimizeHand(chord, rig){
  const fullBarre = !!chord.barre && (chord.barre.to-chord.barre.from+1) >= 3;
  const base = {pitch:0, yaw:0, roll:0, yK: fullBarre ? HAND_CFG.yKb : HAND_CFG.yK, zK: fullBarre ? HAND_CFG.zKb : HAND_CFG.zK, dx1:0, dx2:0, dx3:0, dx4:0};
  const pressing = new Set(chord.fingers.filter(Boolean));
  // いくつかの出発点から探して、いちばん無理のない形を選ぶ（行き止まりにはまらないように）
  const starts = [
    base,
    {...base, pitch:20, yaw:20, yK:52},
    {...base, pitch:-20, roll:-15, yK:44},
    {...base, dx1:-14, dx2:-7, yaw:15},
    {...base, dx1:-18, dx2:-9, dx3:-3, pitch:15, yK:50},
    {...base, roll:15, zK:-22, yK:40},
  ];
  let best = null;
  for(const st of starts){
    const r = localSearch(chord, rig, {...st}, pressing, [1, 0.5]);
    if(!best || r.cost < best.cost) best = r;
  }
  return localSearch(chord, rig, best.prm, pressing, [0.5, 0.25, 0.125]);
}

/* ---------- 計算ずみの手の形（表） ----------
   手の形の計算（optimizeHand）は1つ0.3〜1秒かかり、その間は画面が止まる。
   全コードの「手の向き・位置の数値（prm）」だけをあらかじめ計算して pose-table.js に入れておき、
   ここから1回組み立てるだけにする（数ミリ秒）。表にないコードは、これまでどおりその場で計算する。
   pose.js の手の形の決め方を変えた時は、表を作り直す（tools/make-pose-table.mjs）（ギター・ハンドガイドと同じしくみ） */
const PRM_KEYS = ['pitch','yaw','roll','yK','zK','dx1','dx2','dx3','dx4'];
let PRM_TABLE = null;
export function setPoseTable(t){ PRM_TABLE = t; }
function fromTable(chord, rig){
  const a = PRM_TABLE && PRM_TABLE[chord.name]; if(!a) return null;
  const prm = Object.fromEntries(PRM_KEYS.map((k,i)=>[k, a[i]]));
  const hb = buildHand(chord, rig, prm); hb.prm = prm;
  return hb;
}
// 表を作る時に使う：いま覚えている手の形の数値を書き出す
export function dumpPoseTable(){
  const out = {};
  for(const [k, hb] of poseCache) if(hb && hb.prm) out[k] = PRM_KEYS.map(n=>Math.round(hb.prm[n]*1000)/1000);
  return out;
}
export const clearPoseCache = () => poseCache.clear();

export function computePose(chord, rig){
  const t0 = performance.now();
  let hb = poseCache.get(chord.name);
  if(!hb){ hb = fromTable(chord, rig) || optimizeHand(chord, rig); poseCache.set(chord.name, hb); }
  const {H, W, K, M, fingers, tipX, th, toWd, barre} = hb;
  const thumb = th.pts.map(v=>toWorld(H, W, v));

  // 関節ごとの位置と向き
  const joints = [];
  const J = (name, pos, fwd, dorsal, f=0, i=0) => joints.push({name, pos, fwd:norm(fwd), dorsal:norm(dorsal), f, i});
  J('wrist', W, H.F, H.U);
  { const A = norm(HAND_CFG.arm); const fw = mul(A,-1); J('forearm', W, fw, sub(H.U, mul(fw, dot(H.U,fw)))); }
  for(let f=1; f<=4; f++){
    { const Bm = rig.restBasis[jointName(f,0)]; J(jointName(f,0), M[f], sub(K[f],M[f]), add(add(mul(H.X,Bm[1][0]), mul(H.Y,Bm[1][1])), mul(H.Z,Bm[1][2])), f, 0); }
    const {pts, axis} = fingers[f];
    for(let i=0;i<4;i++){
      const fwd = norm(sub(pts[Math.min(i+1,3)], pts[Math.min(i,2)]));
      J(jointName(f,i+1), pts[i], fwd, cross(fwd, axis), f, i+1);
    }
  }
  for(let i=0;i<4;i++){
    const B = rig.thumbModel.restBasis[i], R = th.Rs[i];
    const mv = v => [R[0][0]*v[0]+R[0][1]*v[1]+R[0][2]*v[2], R[1][0]*v[0]+R[1][1]*v[1]+R[1][2]*v[2], R[2][0]*v[0]+R[2][1]*v[1]+R[2][2]*v[2]];
    J(THUMB_JOINTS[i], thumb[i], toWd(mv(mul(B[2],-1))), toWd(mv(B[1])), 5, i);
  }

  // 弦：押さえたところで指板側へ沈む
  const str = [0,1,2,3].map(s=>{
    if(!chord.frets[s]) return null;
    const f = chord.fingers[s];
    const cx = (barre && f===1 && chord.frets[s]===barre.fret) ? fretX(barre.fret)-6 : tipX[f];
    return {contact: cx, fret: fretX(chord.frets[s])};
  });
  const xs = Object.values(tipX);
  const center = xs.length ? (Math.min(...xs)+Math.max(...xs))/2 : fretX(1.5);
  window.__thumbInfo = {ang: th.ang, cost: th.cost, total: hb.cost, prm: hb.prm, parts: hb.parts, ms: performance.now()-t0};
  return {joints, fingers, str, chord, target:[Math.min(Math.max(center,30),80), 10, -4]};
}

/* ---------- コードチェンジのアニメーション ---------- */
export function blendPose(A, B, t){
  const ease = t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2, lift = Math.sin(Math.PI*t);
  const moved = {};
  for(let f=1; f<=4; f++) moved[f] = vlen(sub(A.fingers[f].pts[3], B.fingers[f].pts[3])) > 0.5;
  const up = [0, 0.35, 0.94];
  const joints = A.joints.map((ja,k)=>{
    const jb = B.joints[k];
    let pos = lerp3(ja.pos, jb.pos, ease);
    if(jb.f>=1 && jb.f<=4 && moved[jb.f] && jb.i>=2) pos = add(pos, mul(up, lift*[0,0,6,11,14][jb.i]));
    return {...jb, pos, fwd:norm(lerp3(ja.fwd, jb.fwd, ease)), dorsal:norm(lerp3(ja.dorsal, jb.dorsal, ease))};
  });
  const fingers = {};
  for(let f=1; f<=4; f++) fingers[f] = {...B.fingers[f], mode: t<.5 ? A.fingers[f].mode : B.fingers[f].mode,
    pts: A.fingers[f].pts.map((p,i)=>lerp3(p, B.fingers[f].pts[i], ease))};
  return {joints, fingers, str: t<.5 ? A.str : B.str, chord: B.chord, target: lerp3(A.target, B.target, ease)};
}
