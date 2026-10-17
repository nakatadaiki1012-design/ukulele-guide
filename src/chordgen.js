/* =========================================================
   コードの押さえ方を自動でさがす（手で書いた押さえ方がないコード用）
   ・4本の弦（G・C・E・A）それぞれ 0〜7フレットの組み合わせを全部ためし、
     コードの音だけが鳴って、必要な音がそろうものを集める
   ・その中から「低い位置」「指の開き（フレットの幅）が小さい」「開放弦を使う」
     「使う指が少ない」ものを選ぶ
   ・指の割り当て：いちばん低いフレットを何本も押さえる時は人差し指でセーハ、
     ほかは低いフレットから順に 1→2→3→4 の指
   ========================================================= */
const OPEN = [7, 0, 4, 9];                 // 開放弦の音（G・C・E・A。C=0 として半音で数える）
const PC = {C:0, 'C♯':1, 'D♭':1, D:2, 'D♯':3, 'E♭':3, E:4, F:5, 'F♯':6, 'G♭':6, G:7, 'G♯':8, 'A♭':8, A:9, 'A♯':10, 'B♭':10, B:11};
// コードの種類 → 根音からの音程（半音）。opt は省いてもよい音（5度）
export const INTERVALS = {
  '':[0,4,7], 'm':[0,3,7], '7':[0,4,7,10], 'm7':[0,3,7,10], 'maj7':[0,4,7,11],
  'sus4':[0,5,7], '6':[0,4,7,9], 'm6':[0,3,7,9], 'dim':[0,3,6,9], 'aug':[0,4,8],
  'add9':[0,4,7,2], '7sus4':[0,5,7,10], 'm7-5':[0,3,6,10], 'sus2':[0,2,7]
};
const MAX_FRET = 7;

export function parseChordName(name){
  const m = name.match(/^([A-G][♯♭]?)(.*)$/);
  if(!m || PC[m[1]] === undefined || !INTERVALS[m[2]]) return null;
  return {root: PC[m[1]], type: m[2]};
}

// 指の割り当て。無理なら null
// 低いフレット（同じなら4弦側）から順に、フレットの差に合わせて 1→2→3→4 の指
function seq(list, prev, f0, fingers){
  for(const o of [...list].sort((a,b)=> a.f - b.f || a.i - b.i)){
    const want = Math.max(prev + 1, 1 + o.f - f0);
    if(want > 4) return false;
    fingers[o.i] = want; prev = want;
  }
  return true;
}
function assignFingers(frets){
  const fretted = frets.map((f,i)=>({f, i})).filter(o=>o.f > 0);
  if(!fretted.length) return {fingers:[0,0,0,0], barre:null};
  const f0 = Math.min(...fretted.map(o=>o.f));
  const fingers = [0,0,0,0];
  const plain = seq(fretted, 0, f0, fingers) ? {fingers, barre:null} : null;
  // セーハ：いちばん低いフレットが2本以上あり、その間の弦も押さえている時。
  // 指が足りない時と、4本とも押さえる時（人差し指で寝かせた方が楽）に使う
  const atF0 = fretted.filter(o=>o.f === f0).map(o=>o.i);
  const lo = Math.min(...atF0), hi = Math.max(...atF0);
  if(atF0.length >= 2 && frets.slice(lo, hi+1).every(f => f >= f0) && (!plain || fretted.length === 4)){
    const fb = [0,0,0,0];
    for(let s=lo; s<=hi; s++) if(frets[s] === f0) fb[s] = 1;
    const rest = fretted.filter(o => !(o.f === f0 && o.i >= lo && o.i <= hi));
    if(seq(rest, 1, f0, fb)) return {fingers: fb, barre: {fret: f0, finger: 1, from: lo, to: hi}};
  }
  return plain;
}

const cache = new Map();
export function generateChord(name){
  if(cache.has(name)) return cache.get(name);
  const p = parseChordName(name);
  if(!p){ cache.set(name, null); return null; }
  const ivs = INTERVALS[p.type];
  const pcs = ivs.map(v => (p.root + v) % 12);
  const fifth = (p.root + 7) % 12;
  const optional = ivs.length >= 4 && ivs.includes(7) ? new Set([fifth]) : new Set();   // 4音のコードは5度を省いてもよい
  let best = null, bestScore = Infinity;
  const f = [0,0,0,0];
  for(f[0]=0; f[0]<=MAX_FRET; f[0]++) for(f[1]=0; f[1]<=MAX_FRET; f[1]++)
  for(f[2]=0; f[2]<=MAX_FRET; f[2]++) for(f[3]=0; f[3]<=MAX_FRET; f[3]++){
    const notes = f.map((x,i)=> (OPEN[i] + x) % 12);
    if(notes.some(n => !pcs.includes(n))) continue;                         // コード以外の音が鳴る
    const have = new Set(notes);
    const missing = pcs.filter(n => !have.has(n));
    if(missing.some(n => !optional.has(n))) continue;                         // 必要な音が足りない
    const fr = f.filter(x => x > 0);
    const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
    if(span > 3) continue;
    const fa = assignFingers(f);
    if(!fa) continue;
    const maxF = fr.length ? Math.max(...fr) : 0;
    const used = new Set(fa.fingers.filter(Boolean)).size;
    let score = maxF*1.2 + fr.reduce((a,b)=>a+b, 0)*0.25 + span*0.9 + used*0.6
              + missing.length*2.5 + (fa.barre ? 1.2 : 0) - (4 - fr.length)*0.3
              + Math.max(0, maxF - 4)*2.2;                                       // 5フレットより上は避ける
    if(!have.has(p.root)) score += 4;
    if(score < bestScore){ bestScore = score; best = {frets:[...f], fingers:fa.fingers, barre:fa.barre}; }
  }
  cache.set(name, best);
  return best;
}
