/* =========================================================
   画質と軽さ：端末の性能に合わせて、背景・手・ウクレレの細かさを切り替える
   ・auto（自動）：端末の種類（スマホか）、CPUの数、メモリ、画面の細かさから「きれい／ふつう／軽い」を決める
   ・設定の⚙ →「軽さ」で手動でも選べる（変えると読み込み直す）
   どの項目をどう軽くするかは TIERS に書いてある。描画中の自動調整（解像度を下げる・影を切る）は別にある（app.js）
   ========================================================= */
export const TIERS = {
  high: { label:'きれい',  pr:1.5,  aa:true,  shadow:2048, subdiv:2, bg:1,    tex:1 },
  mid:  { label:'ふつう',  pr:1.25, aa:true,  shadow:1024, subdiv:1, bg:0.5,  tex:0.5 },
  low:  { label:'軽い',    pr:1.0,  aa:false, shadow:0,    subdiv:1, bg:0.25,  tex:0.25 },
};
//  pr：解像度（画面の細かさの何倍まで描くか）  aa：ふちのギザギザ取り  shadow：影の細かさ（0＝影なし）
//  subdiv：手の表面をなめらかにする回数  bg：背景の絵の大きさ・模様の数（1＝そのまま）  tex：木目の絵の大きさ

export function detectTier(){
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || (mobile ? 3 : 8);
  const dpr = window.devicePixelRatio || 1;
  let gpu = '';
  try{
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : '');
  }catch(e){}
  const weakGpu = /Mali-4|Mali-T|Adreno \(TM\) [345]|PowerVR|SwiftShader|Intel\(R\) HD Graphics [3-5]/i.test(gpu);
  let tier;
  if(!mobile && !weakGpu) tier = 'high';
  else if(mobile && (mem <= 3 || cores <= 4 || weakGpu)) tier = 'low';
  else if(weakGpu) tier = 'mid';
  else tier = dpr >= 3 ? 'low' : 'mid';                            // 画面がとても細かいスマホは描く量が多いので軽めに
  return {tier, mobile, cores, mem, dpr, gpu};
}

let level = 'auto', info = null;
try{ level = localStorage.getItem('ukeQuality') || 'auto'; }catch(e){}
info = detectTier();
export const QUALITY_LEVEL = level;
export const DETECTED = info;
export const Q = {...TIERS[TIERS[level] ? level : info.tier], tier: TIERS[level] ? level : info.tier};

export function setQualityLevel(l){
  try{ localStorage.setItem('ukeQuality', l); }catch(e){}
}
