/* =========================================================
   縦のコード表（SVG）。chord.label があれば見出しにそれを使う（ソロ弾きの1音）
   ========================================================= */
import { STRING_NAMES, FINGER_COLORS } from './data.js';

export function diagramSVG(chord){
  const L=28, T=40, W=94, H=150, cols=4, rows=5;
  const sx = i => L + i*W/(cols-1), sy = j => T + j*H/rows;
  let s = `<rect width="150" height="210" rx="10" fill="#faf8f3"/>`;
  s += `<text x="75" y="26" text-anchor="middle" font-size="24" font-weight="800" fill="#1b1410">${chord.label || chord.name}</text>`;
  for(let j=0;j<=rows;j++) s += `<line x1="${L}" x2="${L+W}" y1="${sy(j)}" y2="${sy(j)}" stroke="#555" stroke-width="${j?1.4:5}"/>`;
  for(let i=0;i<cols;i++){
    s += `<line x1="${sx(i)}" x2="${sx(i)}" y1="${T}" y2="${T+H}" stroke="#333" stroke-width="1.6"/>`;
    s += `<text x="${sx(i)}" y="${T+H+16}" text-anchor="middle" font-size="11" fill="#555">${STRING_NAMES[i]}</text>`;
    if(chord.frets[i]===0) s += `<circle cx="${sx(i)}" cy="${T-10}" r="5" fill="none" stroke="#333" stroke-width="1.6"/>`;
  }
  if(chord.barre){
    const b = chord.barre, y = (sy(b.fret-1)+sy(b.fret))/2;
    s += `<rect x="${sx(b.from)-9}" y="${y-9}" width="${sx(b.to)-sx(b.from)+18}" height="18" rx="9" fill="${FINGER_COLORS[1]}"/>`;
  }
  chord.frets.forEach((fr,i)=>{
    if(!fr) return;
    const f = chord.fingers[i];
    if(chord.barre && f===1 && fr===chord.barre.fret) {
      s += `<text x="${sx(i)}" y="${(sy(fr-1)+sy(fr))/2+4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="#1b1410">1</text>`;
      return;
    }
    const y = (sy(fr-1)+sy(fr))/2;
    s += `<circle cx="${sx(i)}" cy="${y}" r="9.5" fill="${FINGER_COLORS[f]}" stroke="#1b1410" stroke-width="1.2"/>`;
    s += `<text x="${sx(i)}" y="${y+4.5}" text-anchor="middle" font-size="12" font-weight="800" fill="#1b1410">${f}</text>`;
  });
  return `<svg viewBox="0 0 150 210" aria-label="${chord.name}のコード表">${s}</svg>`;
}
