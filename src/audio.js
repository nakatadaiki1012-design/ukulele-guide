/* =========================================================
   音（カープラス・ストロング法でウクレレっぽい音を合成）
   音はすべて Web Audio の時計（actx.currentTime）で予約して鳴らす
   ========================================================= */
import { STRING_MIDI } from './data.js';

export let actx = null;
let master = null;
const bufCache = {};
export function ensureAudio(){
  if(!actx){
    actx = new (window.AudioContext||window.webkitAudioContext)();
    // 弦の音 → 胴の響き（木の箱が鳴る）→ 部屋の響き（ほんの少し）→ スピーカー
    master = actx.createGain(); master.gain.value = 0.62;
    const body = actx.createConvolver(); body.normalize = false; body.buffer = bodyIR();
    const room = actx.createConvolver(); room.buffer = roomIR();
    const wet = actx.createGain(); wet.gain.value = 0.16;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7500;
    master.connect(body); body.connect(lp); lp.connect(actx.destination);
    lp.connect(room); room.connect(wet); wet.connect(actx.destination);
    // 弦の音（C4〜C6あたり）を、ひまな時に1つずつ先に作っておく（初めて鳴らす音で引っかからないように）
    const notes = []; for(let m=60; m<=84; m++) notes.push(m);
    const warm = () => { if(notes.length){ pluckBuffer(notes.shift()); setTimeout(warm, 40); } };
    setTimeout(warm, 200);
  }
  if(actx.state==='suspended') actx.resume();
}
// 決まった乱数
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }

/* ウクレレの胴の響き：胴の中の空気と表板が、いくつかの決まった高さでよく鳴る（共鳴）。
   その鳴り方（すぐ消える響き）を足し合わせたものを、弦の音に重ねる（たたみこみ）。いちばん頭は元の音そのもの */
const BODY_MODES = [   // [高さHz, 強さ, 消える速さ（秒）]：コンサートウクレレの胴の共鳴の目安
  [270, 0.55, 0.050], [420, 0.40, 0.040], [560, 0.30, 0.032], [880, 0.20, 0.022],
  [1250, 0.14, 0.016], [2050, 0.08, 0.010], [3100, 0.05, 0.007]];
function bodyIR(){
  const sr = actx.sampleRate, n = Math.floor(sr*0.25), b = actx.createBuffer(2, n, sr);
  for(let ch=0; ch<2; ch++){
    const y = b.getChannelData(ch);
    y[0] = 1;
    for(const [f, a, d] of BODY_MODES){
      const ff = f*(ch ? 1.01 : 0.99);                       // 左右で少しだけ違えて広がりを出す
      for(let i=1;i<n;i++){ const t = i/sr; y[i] += a*0.06*Math.exp(-t/d)*Math.sin(2*Math.PI*ff*t); }
    }
  }
  return b;
}
// 部屋の響き：ほんの少し（0.5秒くらいで消える、さらさらした響き）
function roomIR(){
  const sr = actx.sampleRate, n = Math.floor(sr*0.7), b = actx.createBuffer(2, n, sr);
  for(let ch=0; ch<2; ch++){
    const y = b.getChannelData(ch), r = rng(911 + ch*7);
    let lp = 0;
    for(let i=0;i<n;i++){ const t = i/sr; lp = lp*0.6 + (r()*2-1)*0.4; y[i] = lp*Math.exp(-t/0.16)*(t < 0.012 ? t/0.012 : 1)*0.35; }
  }
  return b;
}

/* 弦の音（カープラス・ストロング法を、ナイロン弦向けに手直ししたもの）
   ・音の高さ：1往復の遅れを「整数＋小数（オールパスフィルタ）」にして、ぴったり正しい高さに（前は最大10セントずれていた）
   ・はじく場所：サウンドホールのあたり（弦の長さの約1/5）ではじくと出にくくなる倍音を、最初の波から抜いておく
   ・指の腹で弾くやわらかさ：最初の波をなめらかにする（爪のような硬い音にしない）
   ・ナイロン弦：高い倍音ほど早く消える。低い音は長く、高い音は短く響く */
function pluckBuffer(midi){
  if(bufCache[midi]) return bufCache[midi];
  const sr = actx.sampleRate, f0 = 440*Math.pow(2,(midi-69)/12);
  const len = Math.floor(sr*2.6);
  const buf = actx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const D = sr/f0;                                   // 1往復の長さ（サンプル）
  const S = 0.44;                                    // ループの中のなめらかにする強さ（0.5で最大：大きいほどやわらかい）
  const N = Math.floor(D - S - 0.15), d = D - N - S; // 整数の遅れ N と、オールパスで作る小数の遅れ d（0.15〜1.15）
  const C = (1 - d)/(1 + d);
  const T60 = Math.max(1.1, 3.0 - (midi-60)*0.07);   // 音が1/1000（-60dB）まで小さくなる時間（秒）
  const rho = Math.pow(0.001, 1/(f0*T60));
  // 最初の波：ノイズ → はじく場所の倍音を抜く → 指の腹のやわらかさ
  const r = rng(midi*13+5), P = Math.max(1, Math.round(D*0.2)), exc = new Float32Array(N+P+2);
  const raw = new Float32Array(N+P+2); for(let i=0;i<raw.length;i++) raw[i] = r()*2-1;
  let lp = 0;
  for(let i=0;i<=N;i++){ const v = raw[i] - (i >= P ? raw[i-P] : 0); lp = lp*0.45 + v*0.55; exc[i] = lp; }
  // ループ
  let apIn = 0, apOut = 0;
  for(let i=0;i<len;i++){
    const a = i-N >= 0 ? y[i-N] : 0, b = i-N-1 >= 0 ? y[i-N-1] : 0;
    const u = rho*((1-S)*a + S*b);
    const v = C*u + apIn - C*apOut; apIn = u; apOut = v;
    y[i] = (i <= N ? exc[i] : 0) + v;
  }
  // はじいた瞬間の小さな「ピッ」（指が弦にふれる音）
  const r2 = rng(midi*7+3), nClick = Math.floor(sr*0.004);
  for(let i=0;i<nClick;i++) y[i] += (r2()*2-1)*0.12*(1 - i/nClick);
  let mx = 0; for(let i=0;i<len;i++) mx = Math.max(mx, Math.abs(y[i]));
  for(let i=0;i<len;i++) y[i] /= (mx||1);
  bufCache[midi] = buf; return buf;
}
export function playString(si, fret, when, vol){
  const midi = STRING_MIDI[si] + fret;
  const src = actx.createBufferSource(); src.buffer = pluckBuffer(midi);
  const g = actx.createGain();
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when+0.004);
  g.gain.exponentialRampToValueAtTime(0.0008, when+2.3);
  src.connect(g); g.connect(master); src.start(when); src.stop(when+2.4);
}
// ダウン（4弦→1弦）／アップ（1弦→4弦）
export function playStroke(chord, dir, when, vol, gap=0.012){
  for(let k=0;k<4;k++){ const si = dir==='D' ? k : 3-k; playString(si, chord.frets[si], when + k*gap, vol); }
}
// メトロノームのクリック（accent＝1拍目）
export function click(when, accent){
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = accent? 1500 : 1000;
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(accent?0.25:0.15, when+0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when+0.06);
  o.connect(g); g.connect(actx.destination); o.start(when); o.stop(when+0.08);
}
// オルゴールのような音（チンと鳴って、ゆっくり消える）
export function playBell(midi, when){
  const f = 440*Math.pow(2,(midi-69)/12), g = actx.createGain();
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.06, when+0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, when+1.6);
  for(const [mult, v] of [[1,1],[3.01,0.18],[5.2,0.05]]){
    const o = actx.createOscillator(), og = actx.createGain(); o.type = 'sine'; o.frequency.value = f*mult; og.gain.value = v;
    o.connect(og); og.connect(g); o.start(when); o.stop(when+1.7);
  }
  g.connect(actx.destination);
}
// メロディの音（やわらかい笛のような音）
export function playNote(midi, when, dur){
  const f = 440*Math.pow(2,(midi-69)/12);
  const g = actx.createGain(), lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2600;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.11, when+0.03);
  g.gain.exponentialRampToValueAtTime(0.07, when+0.15);
  g.gain.setValueAtTime(0.07, when+Math.max(0.16, dur-0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, when+dur+0.05);
  for(const [type, mult, v] of [['triangle',1,1],['sine',2,0.25]]){
    const o = actx.createOscillator(), og = actx.createGain();
    o.type = type; o.frequency.value = f*mult; og.gain.value = v;
    // ほんの少しビブラート
    const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = 5.2; lg.gain.value = f*mult*0.004;
    lfo.connect(lg); lg.connect(o.frequency); lfo.start(when); lfo.stop(when+dur+0.1);
    o.connect(og); og.connect(g); o.start(when); o.stop(when+dur+0.1);
  }
  g.connect(lp); lp.connect(actx.destination);
}

/* 今スピーカーから聞こえている音の時刻（Web Audio の時計で）。画面の動きはこれに合わせると、音とずれない */
let lastHeard = -1e9;
export function heardTime(){
  let t;
  const ts = actx.getOutputTimestamp ? actx.getOutputTimestamp() : null;
  if(ts && ts.performanceTime > 0) t = ts.contextTime + (performance.now() - ts.performanceTime)/1000;
  else t = actx.currentTime - (actx.outputLatency || actx.baseLatency || 0);
  if(t < lastHeard) t = lastHeard;                          // 時計が戻らないように
  return (lastHeard = t);
}
