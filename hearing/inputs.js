/* inputs.js ― 数・時間・寸法の「入れ方」（画面に出す前の読み書き）
 *
 *   ★ここは DOM を触りません。node から検査できます（test/input-test.mjs）。
 *   ★書き出す形は extract.js が拾う形と、文字まで同じにします。
 *       人員数 35名 ／ 要求能力 3000行 ／ 入荷量 3000ケース
 *       作業時間 08:00-17:00 ／ 収納サイズ 600×400×300 ／ 予算規模 300000（千円）
 *     手で入れても、メモから拾っても、同じ文字列になります。
 *
 *   ★読めない文字は捨てません。
 *     「3000〜5000ケース」のような、数字の箱に収まらないものが来たら
 *     ok:false を返し、画面は「文で書く」に落ちます（黙って入れ替えない）。
 *
 *   ★extract.js の ならす（全角→半角・桁区切りを外す）を借りています。
 *     読み込みの順番は index.html で extract.js のあとにしてください。
 */
(function (root) {
  'use strict';

  var ならす = (root.EXTRACT && root.EXTRACT.ならす) ||
    function (s) { return s == null ? '' : String(s); };   // 単独で読んだときも落ちないように

  function str(v) { return v == null ? '' : String(v); }
  function p2(n) { return ('0' + n).slice(-2); }

  // ── 数＋単位 ───────────────────────────────────────
  //  「35名」→ {数:'35', 単位:'名'}／「300000」→ {数:'300000', 単位:''}
  function 読num(v) {
    var t = ならす(str(v)).trim();
    if (!t) return { ok: true, 数: '', 単位: '' };
    var m = /^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/.exec(t);
    if (!m) return { ok: false };
    var u = m[2].trim();
    if (/[0-9]/.test(u)) return { ok: false };        // 「3000〜5000」「600×400」など
    return { ok: true, 数: m[1], 単位: u };
  }
  function 組num(数, 単位) {
    var n = str(数).trim();
    return n ? n + str(単位).trim() : '';
  }

  // ── 時間帯 ────────────────────────────────────────
  //  「08:00-17:00」→ {時1:'08:00', 時2:'17:00'}／「15:00」→ {時1:'15:00', 時2:''}
  //  片方だけでも通します（出荷の〆切時間は1つだけのことがある）
  var 時 = '([0-2]?[0-9])\\s*[:：]\\s*([0-5][0-9])';
  var SPAN = new RegExp('^' + 時 + '(?:\\s*[-〜～~ー]\\s*' + 時 + ')?$');
  function 読span(v) {
    var t = ならす(str(v)).trim();
    if (!t) return { ok: true, 時1: '', 時2: '' };
    var m = SPAN.exec(t);
    if (!m) return { ok: false };
    if (+m[1] > 24 || (m[3] !== undefined && +m[3] > 24)) return { ok: false };
    return {
      ok: true,
      時1: p2(+m[1]) + ':' + m[2],
      時2: m[3] === undefined ? '' : p2(+m[3]) + ':' + m[4]
    };
  }
  function 組span(時1, 時2) {
    var a = str(時1).trim(), b = str(時2).trim();
    if (a && b) return a + '-' + b;
    return a || b;                                    // 片方だけならそれだけ
  }

  // ── 寸法（W×L×H）─────────────────────────────────
  //  「600×400×300」→ {寸:['600','400','300']}。2つまでしか聞けていなくても通します
  function 読dim(v) {
    var t = ならす(str(v)).trim();
    if (!t) return { ok: true, 寸: ['', '', ''] };
    var a = t.split(/\s*[×xX*＊]\s*/);
    if (a.length > 3) return { ok: false };
    for (var i = 0; i < a.length; i++) {
      if (!/^[0-9]+(?:\.[0-9]+)?$/.test(a[i])) return { ok: false };   // 「W600」「600角」など
    }
    return { ok: true, 寸: [a[0] || '', a[1] || '', a[2] || ''] };
  }
  function 組dim(寸) {
    var a = (寸 || []).map(function (x) { return str(x).trim(); });
    while (a.length && !a[a.length - 1]) a.pop();      // 後ろの空きは落とす
    if (!a.length) return '';
    if (a.some(function (x) { return !x; })) return null;  // 間が空いている（組み立てられない）
    return a.join('×');
  }

  // ── 読み書きの入口 ────────────────────────────────
  /**
   * しまってある文字を、入れ方ごとの部品にほどく。
   * @returns {{ok:boolean}} ok:false なら「文で書く」に落とす
   */
  function 読み取る(kind, value) {
    if (kind === 'num') return 読num(value);
    if (kind === 'span') return 読span(value);
    if (kind === 'dim') return 読dim(value);
    return { ok: false };
  }
  /** 部品から、しまう文字を組み立てる。組み立てられないときは null */
  function 組み立てる(kind, 部品) {
    部品 = 部品 || {};
    if (kind === 'num') return 組num(部品.数, 部品.単位);
    if (kind === 'span') return 組span(部品.時1, 部品.時2);
    if (kind === 'dim') return 組dim(部品.寸);
    return null;
  }

  // ── 数字の箱に入れていい文字か ──────────────────────
  /** 数字（と小数点）だけか。全角で来ても ならす のあとで見る */
  function 数だけ(s) { return /^[0-9]*(?:\.[0-9]*)?$/.test(ならす(str(s)).trim()); }

  // ── 読み返し（打った数が合っているか目で確かめるため）──────
  /** 3000 → 「3,000」 */
  function 区切る(n) {
    var t = str(n).trim();
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(t)) return t;
    var a = t.split('.');
    a[0] = a[0].replace(/\B(?=(?:[0-9]{3})+$)/g, function () { return ','; });
    return a.join('.');
  }
  /** 千円で入れた数を、ふだんの言い方に直す（表示だけ。しまう文字は変えない） */
  function 円に(千円) {
    var v = parseFloat(ならす(str(千円)));
    if (!isFinite(v) || v <= 0) return '';
    var 円 = v * 1000, 丸 = function (x) { return String(Math.round(x * 100) / 100); };
    if (円 >= 1e8) return 丸(円 / 1e8) + '億円';
    if (円 >= 1e4) return 丸(円 / 1e4) + '万円';
    return 丸(円) + '円';
  }

  root.INPUTS = {
    読み取る: 読み取る, 組み立てる: 組み立てる,
    数だけ: 数だけ, ならす: ならす, 区切る: 区切る, 円に: 円に
  };
})(typeof self !== 'undefined' ? self : this);
