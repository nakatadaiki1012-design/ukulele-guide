/* =========================================================
   曲デモの楽譜（HTML／SVGを作るだけ。押した時の動きは app.js）
   ・コード弾き：小節ごとのコードのボタンを、1行8小節の表にそろえて並べる
   ・ソロ弾き：横に長いタブ譜（上から A・E・C・G 弦の4本線にフレットの数字。上にコード名、下にドレミ）
   ========================================================= */
import { STRING_MIDI, doremi } from './data.js';

// コード弾きの楽譜。コードを押すと鳴らして、そこから演奏できる（data-beat＝その拍から）
export function chordSheetHTML(sg){
  return sg.bars.map((b,i)=>{ let off = 0;
    return `<div class="bar fl">${sg.silentBars?.has(i)
      ? `<button class="cb muted" data-beat="${sg.startBeat ?? i*sg.beats}" title="アウフタクト（メロディだけ）">♪</button>`   // アウフタクト
      : b.map(([c,n])=>{ const beat = i*sg.beats + off; off += n;
          return `<button class="cb" data-beat="${beat}" data-c="${c}" title="押すと鳴らす・ここから演奏">${c}${sg.onceBars?.has(i) ? '<small>1拍</small>' : ''}</button>`; }).join('')}</div>`; }).join('');
}
// 1行に8小節ずつ、表のようにそろえる。アウフタクト（1小節目が弾き出しだけ）の曲は、
// その小節を左の細い列に置いて、2小節目から行の頭がそろうようにする。4小節ごとに少し太い区切り線
export function layoutSheet(el, sg, per = 8){
  const pick = !!sg.silentBars?.has(0);
  el.style.gridTemplateColumns = (pick ? 'auto ' : '') + `repeat(${per}, minmax(0,1fr))`;
  el.querySelectorAll('.bar').forEach((bar,i)=>{
    const j = pick ? i-1 : i;
    if(pick && i === 0){ bar.style.gridRow = '1'; bar.style.gridColumn = '1'; bar.classList.add('pick'); return; }
    bar.style.gridRow = String(Math.floor(j/per) + 1); bar.style.gridColumn = String(j%per + 1 + (pick ? 1 : 0));
    bar.classList.toggle('phrase', j % 4 === 0);
  });
}

// タブ譜。数字（.tn）を押すと、その音を鳴らして、そこから演奏できる（data-i＝何番目の音か）
export const TAB_X0 = 72;                                          // 1小節目の頭の位置（左の線＝演奏中の今の位置）
const TAB_PPB = 34, TAB_LINE = [26, 38, 50, 62];                   // 1拍の幅・弦の線の高さ（上から A E C G）
export const tabX = beat => TAB_X0 + beat*TAB_PPB;
export function tabSVG(sg){
  const beats = sg.soloBars*sg.beats, W = tabX(beats) + 260, ly = si => TAB_LINE[3-si];
  let s = `<svg width="${W}" height="92" viewBox="0 0 ${W} 92" xmlns="http://www.w3.org/2000/svg">`;
  ['A','E','C','G'].forEach((n,i)=>{ s += `<line x1="${TAB_X0-14}" x2="${tabX(beats)}" y1="${TAB_LINE[i]}" y2="${TAB_LINE[i]}" stroke="#9a8f84" stroke-width="1"/>`;
    s += `<text x="${TAB_X0-24}" y="${TAB_LINE[i]+4}" font-size="10" fill="#8a7f74" text-anchor="middle">${n}</text>`; });
  s += `<text x="${TAB_X0-40}" y="48" font-size="12" font-weight="800" fill="#8a7f74" text-anchor="middle" transform="rotate(-90 ${TAB_X0-40} 44)">TAB</text>`;
  // 小節線と、小節の頭のコード名
  for(let i=0; i<=sg.soloBars; i++){
    const x = tabX(i*sg.beats) - (i ? 6 : 14);
    s += `<line x1="${x}" x2="${x}" y1="${TAB_LINE[0]}" y2="${TAB_LINE[3]}" stroke="#6b6158" stroke-width="${i===sg.soloBars ? 2.5 : 1}"/>`;
    const ac = sg.accomp && sg.accomp[i];
    if(ac && i < sg.soloBars) s += `<text x="${x+4}" y="13" font-size="11" font-weight="800" fill="#13a89e">${ac[0]}</text>`;
  }
  // 音：弦の線の上にフレットの数字、下にドレミ
  sg.solo.forEach(([b, len, si, f], j)=>{
    const x = tabX(b), y = ly(si), w = String(f).length*8 + 6;
    s += `<g class="tn" data-i="${j}"><rect x="${x-w/2}" y="${y-8}" width="${w}" height="16" rx="4"/><text x="${x}" y="${y+4.5}" text-anchor="middle">${f}</text></g>`;
    s += `<text x="${x}" y="84" font-size="10" fill="#6b6158" text-anchor="middle">${doremi(STRING_MIDI[si]+f)}</text>`;
  });
  return s + '</svg>';
}
