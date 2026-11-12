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
    master = actx.createGain(); master.gain.value = 0.7;
    const body = actx.createBiquadFilter(); body.type='peaking'; body.frequency.value=260; body.Q.value=1.2; body.gain.value=5;
    const lp = actx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=5200;
    master.connect(body); body.connect(lp); lp.connect(actx.destination);
    // 弦の音（G4〜B5あたり）を、ひまな時に1つずつ先に作っておく（初めて鳴らす音で引っかからないように）
    const notes = []; for(let m=60; m<=84; m++) notes.push(m);
    const warm = () => { if(notes.length){ pluckBuffer(notes.shift()); setTimeout(warm, 40); } };
    setTimeout(warm, 200);
  }
  if(actx.state==='suspended') actx.resume();
}
// 決まった乱数
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
function pluckBuffer(midi){
  if(bufCache[midi]) return bufCache[midi];
  const sr = actx.sampleRate, freq = 440*Math.pow(2,(midi-69)/12);
  const len = Math.floor(sr*2.4);
  const N = Math.max(2, Math.round(sr/freq - 0.5));
  const buf = actx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const r = rng(midi*13+5);
  let prev = 0;
  for(let i=0;i<N;i++){ const v = r()*2-1; prev = prev*0.5 + v*0.5; y[i] = prev; }
  const decay = 0.9965;
  for(let i=N;i<len;i++) y[i] = decay*0.5*(y[i-N] + y[i-N-1 >= 0 ? i-N-1 : 0]);
  // 頭のノイズを少し整える
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
