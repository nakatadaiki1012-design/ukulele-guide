/* =========================================================
   親指の自然な形をさがす（シミュレーション）
   親指は3つの関節を、人の手が実際に曲がる範囲の中だけで動かす：
     付け根（CM関節）… 曲げ・開き（2方向）
     まん中（MP関節）… 曲げ
     先（IP関節）    … 曲げ（少しだけ反れる）
   その中から「指の腹がネックの裏に軽く当たる」「ネックにめり込まない」
   「楽な形（力の抜けた形）に近い」ものを選ぶ
   ========================================================= */
import { halfW, NECK_DEPTH, add, sub, mul, dot, cross, norm, vlen, DEG } from './geom.js';

const rot = (axis, a) => {            // 回転行列（ロドリゲスの式）
  const [x,y,z] = norm(axis), c = Math.cos(a), s = Math.sin(a), t = 1-c;
  return [[t*x*x+c, t*x*y-s*z, t*x*z+s*y],[t*x*y+s*z, t*y*y+c, t*y*z-s*x],[t*x*z-s*y, t*y*z+s*x, t*z*z+c]];
};
const mm = (A,B) => A.map((r,i)=>[0,1,2].map(j=>A[i][0]*B[0][j]+A[i][1]*B[1][j]+A[i][2]*B[2][j]));
const mv = (A,v) => [dot(A[0],v), dot(A[1],v), dot(A[2],v)];
const I3 = [[1,0,0],[0,1,0],[0,0,1]];

// 関節の動く範囲（度）と、力を抜いたときの角度
const LIMITS = { cmcF:[-15,45], cmcA:[-45,40], mcp:[0,55], ip:[-10,75] };   // モデルの基本姿勢は親指がかなり開いているので、閉じる側は広め
const RELAX  = { cmcF:10, cmcA:5, mcp:15, ip:15 };
const KEYS = ['cmcF','cmcA','mcp','ip'];
const THUMB_R = [11, 10, 9.2];        // 親指の太さ（半径）

/* 手のモデルの基本姿勢（手首から見た座標）から、親指の形を作る準備
   restPos: 4つの関節位置 / restBasis: 各関節の向き（X,Y,Z軸） / palm: 手のひら側の向き */
export function makeThumbModel(restPos, restBasis, palm, awayFrom){
  const d = [0,1,2].map(i=>sub(restPos[i+1], restPos[i]));
  // 曲げる軸：骨の向きと手のひら方向の両方に直交する軸。指先が手のひら側に動く向きを＋にする
  const flexAxis = i => {
    let ax = norm(cross(d[i], palm));
    const test = mv(rot(ax, 0.2), d[i]);
    if(dot(sub(test, d[i]), palm) < 0) ax = mul(ax, -1);
    return ax;
  };
  const axF = [0,1,2].map(flexAxis);
  // 付け根の「開き」の軸：骨の向きと曲げ軸に直交（親指を人差し指から離す向きを＋）
  let axA = norm(cross(d[0], axF[0]));
  // 右手・左手で向きが逆になるので、「人差し指から離れる向き」が＋になるようにそろえる（指定がある時）
  if(awayFrom){
    const tip0 = add(restPos[0], add(d[0], add(d[1], d[2])));
    const moved = add(restPos[0], mv(rot(axA, 0.2), add(d[0], add(d[1], d[2]))));
    if(vlen(sub(moved, awayFrom)) < vlen(sub(tip0, awayFrom))) axA = mul(axA, -1);
  }
  return { restPos, restBasis, d, axF, axA };
}

// 角度 → 関節位置と向き（手首から見た座標）
export function thumbFK(M, ang){
  const R0 = mm(rot(M.axF[0], ang.cmcF*DEG), rot(M.axA, ang.cmcA*DEG));
  const R1 = mm(R0, rot(M.axF[1], ang.mcp*DEG));
  const R2 = mm(R1, rot(M.axF[2], ang.ip*DEG));
  const P0 = M.restPos[0];
  const P1 = add(P0, mv(R0, M.d[0]));
  const P2 = add(P1, mv(R1, M.d[1]));
  const P3 = add(P2, mv(R2, M.d[2]));
  const Rs = [R0, R1, R2, R2];
  return { pts:[P0,P1,P2,P3], Rs };
}

/* 手首の座標 → 実際の座標の変換（toW: 位置, toWd: 向き）と、ネックの形から、いちばん自然な角度をさがす */
// ネックの表面からの距離（外側がプラス）。断面は指板の下が半楕円：中心(0,-5)、横の半径 hw、深さ dpt
export function neckSD(p){
  const hw = halfW(p[0]), dpt = NECK_DEPTH(p[0]);
  if(p[0] < -8) return 50;                                             // ヘッドより先は気にしない
  if(p[2] > -5) return Math.max(Math.abs(p[1]) - hw, p[2]);            // 指板の高さ
  const u = p[1]/hw, v = (p[2]+5)/dpt, r = Math.hypot(u,v);
  return (r-1)*Math.min(hw,dpt);
}

export function solveThumb(M, toW, toWd, opts){
  const { xTarget, yTarget, start } = opts;
  const cost = ang => {
    const { pts, Rs } = thumbFK(M, ang);
    const W = pts.map(toW);
    // 指の腹：先の関節から少し先・手のひら側
    const nail = norm(toWd(mv(Rs[2], M.restBasis[2][1])));
    const fwd = norm(sub(W[3], W[2]));
    const pad = add(add(W[3], mul(fwd, 2)), mul(nail, -6));
    let c = 0;
    if(!opts.peek){
      // 1) 指の腹がネックの裏に軽く当たる（すき間 0〜1mm）
      const g = neckSD(pad);
      c += g > 1 ? (g-1)*(g-1)*0.6 : g < -1 ? (g+1)*(g+1)*3 : 0;
      // 2) 位置の好み：人差し指と中指の間の裏、ネックのまん中より少し4弦側
      c += Math.pow(pad[0]-xTarget, 2)*0.02 + Math.pow(pad[1]-yTarget, 2)*0.03;
    } else {
      // 1') 深く握る：ネックの上の肩に当たるのは親指の腹ではなく、付け根〜まん中の節のあたり
      let gm = 1e9, cp = null;
      for(let t=0;t<=1.001;t+=0.125){
        const s = t < 0.5 ? 1 : 2, u = t < 0.5 ? t*2 : (t-0.5);          // まん中の節〜先の節の半分
        const P = add(W[s], mul(sub(W[s+1],W[s]), u));
        const g = neckSD(P) - THUMB_R[s];
        if(g < gm){ gm = g; cp = P; }
      }
      c += gm > 1 ? (gm-1)*(gm-1)*0.6 : 0;
      c += Math.pow(cp[0]-xTarget, 2)*(opts.xW ?? 0.02);
      // 2b) 親指の先がネックの上の縁（1弦Gの側）からのぞく
      const over = W[3][1] + halfW(W[3][0]) + opts.peek;        // 縁より peek mm 上に出ればゼロ
      if(over > 0) c += over*over*0.3;
      const back = (opts.peekZ ?? -12) - W[3][2];                                 // 先はネックの裏ではなく、横の高さまで回り込む
      if(back > 0) c += back*back*0.15;
    }
    // 3) 親指の骨がネックにめり込まない
    for(let s=0;s<3;s++) for(let t=0;t<=1.001;t+=0.25){
      const P = add(W[s], mul(sub(W[s+1],W[s]), t));
      const pen = THUMB_R[s] - neckSD(P) - (s===2 && t>0.5 ? 3 : 0);
      if(pen > 0) c += pen*pen*2;
    }
    // 3b) ナットより先（ヘッド側）に回り込まない
    for(const P of [...W, pad]) if(P[0] < 4) c += (4-P[0])*(4-P[0])*0.8;
    // 4) 楽な形に近いほどよい
    for(const k of KEYS) c += Math.pow((ang[k]-RELAX[k])/25, 2) * 4;
    return c;
  };
  // 粗くさがしてから、細かく詰める（手の向きを探している途中は、前回の答えから詰めるだけ）
  let best = {...(start || RELAX)}, bc = cost(best);
  if(!start) for(let a=LIMITS.cmcF[0]; a<=LIMITS.cmcF[1]; a+=10)
    for(let b=LIMITS.cmcA[0]; b<=LIMITS.cmcA[1]; b+=10)
      for(let m=LIMITS.mcp[0]; m<=LIMITS.mcp[1]; m+=11)
        for(let i=LIMITS.ip[0]; i<=LIMITS.ip[1]; i+=17){
          const ang = {cmcF:a, cmcA:b, mcp:m, ip:i}, v = cost(ang);
          if(v < bc){ bc = v; best = ang; }
        }
  for(let step = start ? 3 : 6; step>0.4; step*=0.5){
    let improved = true;
    while(improved){
      improved = false;
      for(const k of KEYS) for(const sgn of [-1,1]){
        const ang = {...best, [k]: Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], best[k]+sgn*step))};
        const v = cost(ang);
        if(v < bc - 1e-6){ bc = v; best = ang; improved = true; }
      }
    }
  }
  return { ang: best, cost: bc, ...thumbFK(M, best) };
}

/* 親指の腹を、手の中の目標点（手首から見た座標）にそっと当てる形をさがす（右手のピック持ち用） */
export function solveThumbTo(M, target){
  const cost = ang => {
    const { pts, Rs } = thumbFK(M, ang);
    const nail = norm(mv(Rs[2], M.restBasis[2][1]));
    const fwd = norm(sub(pts[3], pts[2]));
    const pad = add(add(pts[3], mul(fwd, 1)), mul(nail, -6));
    let c = Math.pow(vlen(sub(pad, target)), 2);
    for(const k of KEYS) c += Math.pow((ang[k]-RELAX[k])/30, 2) * 6;
    return c;
  };
  let best = {...RELAX}, bc = cost(best);
  for(let a=LIMITS.cmcF[0]; a<=LIMITS.cmcF[1]; a+=8)
    for(let b=LIMITS.cmcA[0]; b<=LIMITS.cmcA[1]; b+=8)
      for(let m=LIMITS.mcp[0]; m<=LIMITS.mcp[1]; m+=11)
        for(let i=LIMITS.ip[0]; i<=LIMITS.ip[1]; i+=12){
          const ang = {cmcF:a, cmcA:b, mcp:m, ip:i}, v = cost(ang);
          if(v < bc){ bc = v; best = ang; }
        }
  for(let step=4; step>0.3; step*=0.5){
    let improved = true;
    while(improved){ improved = false;
      for(const k of KEYS) for(const sgn of [-1,1]){
        const ang = {...best, [k]: Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], best[k]+sgn*step))};
        const v = cost(ang); if(v < bc - 1e-6){ bc = v; best = ang; improved = true; }
      }
    }
  }
  return { ang: best, cost: bc, ...thumbFK(M, best) };
}
