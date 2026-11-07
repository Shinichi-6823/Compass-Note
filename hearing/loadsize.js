/* ==========================================================================
 * loadsize.js ― 「収納・搬送物サイズ」の**書き方いろいろ**を数字3つに直す
 *
 *   利用者の指示（2026-09-22）: 「収納物情報は案件管理のものとリンクさせたい」
 *
 *   案件管理のヒアリングシートの「収納・搬送物サイズ（W×L×H mm）」は**自由記述**です。
 *   実際の記入例は書き方がまちまちなので、よくある形をひととおり読めるようにしてあります。
 *
 *     600×400×300 ／ 600x400x300 ／ 600*400*300 ／ 600・400・300
 *     W600×L400×H300 ／ W600×D400×H300 ／ 600W×400L×300H
 *     600 × 400 × 300 mm ／ 0.6×0.4×0.3m ／ 60×40×30cm
 *     「ケース 600×400×300、パレット 1100×1100×1500」… **2つ以上でも全部返す**
 *
 *   ★**当てずっぽうはしません。** 3つの数がそろっていないもの（「600×400」など）は返しません。
 *     読めなかったら空の一覧を返すので、呼ぶ側は「読み取れませんでした」と出してください。
 *   ★画面も CASEDB も知りません（Node だけで検査できます）。
 * ========================================================================== */
(function (root) {
  'use strict';

  //  W・L・H の並びは「W×L×H」が基本。ヒアリングシートの見出しがそう書いてある。
  //  ただし D（奥行）と書く人もいるので、印が付いていればそちらを優先する。
  const 印 = { w: 'W', d: 'D', h: 'H', l: 'D' };   // L（長さ）＝奥行として扱う

  /** 単位（mm へそろえる倍率） */
  function 倍率(u) {
    const t = String(u || '').toLowerCase();
    if (t === 'm') return 1000;
    if (t === 'cm') return 10;
    return 1;                                       // mm・無指定
  }

  /** 数字として読む。読めなければ null */
  function num(v) {
    const n = parseFloat(String(v).replace(/[，,]/g, () => ''));
    return isFinite(n) && n > 0 ? n : null;
  }

  /**
   * 1つの「◯×◯×◯」を読む。
   * @param {string} 文 例: 'W600×L400×H300'
   * @param {number} k 単位の倍率
   * @returns {{W:number,D:number,H:number}|null}
   */
  function 一組(文, k) {
    //  数の前後に付いた W/D/L/H の印を拾いながら、数を3つ取り出す
    const 玉 = [];
    const re = /([WDLHwdlh])?\s*([0-9]+(?:[.,][0-9]+)?)\s*([WDLHwdlh])?/g;
    let m;
    while ((m = re.exec(文))) {
      const v = num(m[2]); if (v == null) continue;
      const 札 = (m[1] || m[3] || '').toLowerCase();
      玉.push({ v: v * k, 札: 印[札] || '' });
      if (玉.length >= 8) break;
    }
    if (玉.length < 3) return null;
    const 三 = 玉.slice(0, 3);
    const out = { W: null, D: null, H: null };
    //  印の付いているものを先に置く
    for (const t of 三) if (t.札 && out[t.札] == null) out[t.札] = t.v;
    //  残りは W→D→H の順で埋める
    const 余り = 三.filter(t => !(t.札 && out[t.札] === t.v));
    for (const k2 of ['W', 'D', 'H']) {
      if (out[k2] != null) continue;
      const t = 余り.shift(); if (!t) break;
      out[k2] = t.v;
    }
    if (out.W == null || out.D == null || out.H == null) return null;
    const r = v => Math.round(v * 10) / 10;
    return { W: r(out.W), D: r(out.D), H: r(out.H) };
  }

  /**
   * 自由記述から、寸法の組を**ぜんぶ**取り出す。
   * @param {string} text ヒアリングの「収納・搬送物サイズ」など
   * @returns {Array<{W:number,D:number,H:number,元:string}>} 読めた順。読めなければ []
   */
  function parseSize(text) {
    let t = String(text == null ? '' : text);
    if (!t.trim()) return [];
    //  桁区切りの「,」を外す（1,100×1,100×1,500 を読むため）。★第2引数は関数（CLAUDE.md の約束）
    t = t.replace(/(\d),(?=\d{3}\b)/g, (m, d) => d);
    //  ★**切り分けずに、寸法の形そのものを探します**。
    //    「、」で切る作りだと「オリコン 530×366×325 と 折りたたみ時 530×366×80」の
    //    2つめを取りこぼしました（区切りは「と」だったため）。
    const 数 = '(?:[WDLHwdlh]\\s*)?\\d+(?:\\.\\d+)?\\s*[WDLHwdlh]?';
    const 印 = '\\s*[×xX*・]\\s*';
    const re = new RegExp(数 + 印 + 数 + 印 + 数, 'g');
    const out = [];
    let m;
    while ((m = re.exec(t))) {
      //  単位は、その並びのすぐ後ろに付いていれば使う（600×400×300mm・0.6×0.4×0.3m）
      const 後 = t.slice(m.index + m[0].length, m.index + m[0].length + 4);
      const u = (後.match(/^\s*(mm|cm|m)/i) || [])[1] || '';
      const r = 一組(m[0], 倍率(u));
      if (r) out.push(Object.assign(r, { 元: (m[0] + (u ? u : '')).trim() }));
      if (out.length >= 8) break;
    }
    return out;
  }

  /**
   * 「これ1つ」を選ぶときの既定。いちばん最初に読めたもの。
   * @returns {{W,D,H,元}|null}
   */
  function firstSize(text) { const a = parseSize(text); return a.length ? a[0] : null; }

  const API = { parseSize, firstSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.LOADSIZE = API;
})(typeof self !== 'undefined' ? self : this);
