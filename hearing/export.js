/* ============================================================================
 * export.js ― 書き出し（JSON・CSV・印刷用のHTML）
 *
 *   画面も localStorage も知りません（Node だけで検査できます）。
 *   受け取るのは rec = { data:{欄id:値}, actions:[…], memo:'', 更新 } ひとつだけ。
 *
 *   ★JSON がコンパスへの本道です。
 *     コンパス 案件管理 ＞ ヒアリング ＞「JSONを読み込む」が読む形:
 *       { _schema:'okamura-hearing/1', 欄id:値, …, actions:[{phase,action,todo,when,who,pri,st,note}] }
 *     ・チェックの欄（現在の課題）は**配列**のまま（コンパスの collect と同じ）
 *     ・コンパスは**知らないキーを黙って無視**します（fields() の欄しか見ない）ので、
 *       \_ で始める独自キー（_メモ など）を入れても壊れません
 *     ・つながっている欄（社名・納地・稼働予定…）も入れてよい。コンパスは保存のときに
 *       基本情報・建屋情報へ書き戻します（確かめのダイアログつき）
 *
 *   ★CSV はコンパスの取り込み口がありません（Excel で見る・台帳へ貼る用）。
 *     列と順番は Hearing.csv に合わせてあります（fields.js の csvCols）。
 * ========================================================================== */
(function (root) {
  'use strict';

  var F = function () { return root.FIELDS; };
  var str = function (v) { return String(v == null ? '' : v); };
  var BOM = String.fromCharCode(0xFEFF);        // ★ここに本物の BOM を書かない（CLAUDE.md の約束）

  /** 値を「見せる文字」に直す。チェックの欄は ／ でつなぐ（コンパスと同じ JOIN） */
  function 文字に(v) {
    if (Array.isArray(v)) return v.join(F().JOIN);
    return str(v).trim();
  }

  /** 欄の値。社内版の「1回の答えで両方が埋まる欄」（fields.js の derive）は 0次の答えで決まった値 */
  function 値(id, d) { return F().value ? F().value(id, d) : (d || {})[id]; }

  /** 案件キー＝物件番号。無ければ案件名（コンパスの決めごと。0次提案は案件名） */
  function キー(rec) {
    var d = rec.data || {};
    return str(d['物件番号']).trim() || str(d['物件名称']).trim() || str(d['社名']).trim();
  }
  function 名前(rec) {
    var d = rec.data || {};
    return str(d['物件名称']).trim() || str(d['社名']).trim() || '無題';
  }

  // ── JSON（コンパスの「JSONを読み込む」が読む形） ────────────────
  /**
   * @param {object} rec
   * @param {{メモを入れる?:boolean}} [opt] 既定で入れる（コンパスは無視する独自キー）
   */
  function json(rec, opt) {
    opt = opt || {};
    var d = rec.data || {}, o = {}, scr = {}, nScr = 0;
    F().all.forEach(function (f) {
      var v = 値(f.id, d);            // 社内版の derive の欄は 0次の答えで決まった値
      //  社内版の取捨選択の欄（src:'screening'・id は「取捨:」＋列名）は「取捨選択」へ Screening.csv の列名で
      //  （ヒアリングと同じ名前の欄＝建屋図面・提案範囲 があるので、上の段には混ぜない）
      var to = f.src === 'screening' ? scr : o, k = f.src === 'screening' ? (f.col || f.id) : f.id;
      if (Array.isArray(v)) { if (v.length) { to[k] = v.slice(); if (to === scr) nScr++; } return; }
      if (str(v).trim()) { to[k] = str(v).trim(); if (to === scr) nScr++; }
    });
    if (nScr) o.取捨選択 = scr;
    o.actions = (rec.actions || []).filter(function (a) { return str(a.action).trim(); })
      .map(function (a) {
        return {
          phase: str(a.phase), action: str(a.action), todo: str(a.todo), when: str(a.when),
          who: str(a.who), pri: str(a.pri), st: str(a.st), note: str(a.note)
        };
      });
    //  ★コンパスが見ない独自キー。コンパスノートへ渡すぶん
    if (opt.メモを入れる !== false && str(rec.memo).trim()) o._メモ = str(rec.memo).trim();
    //  打合せメモは議事録として渡す（2026-11-09。コンパスの「JSONを読み込む」が「議事録に入れる（1件）」を出す＝hearing.js の minutesOf の形）
    //  ★_メモ だけだとコンパスは読まない（知らないキー）ので、メモが取り込みで消えていた
    if (opt.メモを入れる !== false && str(rec.memo).trim()) {
      var 日 = str(d['訪問日']).trim() || str(rec.更新).slice(0, 10);
      o.minutes = [{ 議事日付: /^\d{4}-\d{2}-\d{2}$/.test(日) ? 日 : '', 件名: 'ヒヤリング（コンパスヒヤリング）' + (str(d['物件名称']).trim() ? '　' + str(d['物件名称']).trim() : ''),
        議事場所: str(d['打合せ場所']).trim(), 議事内容: str(rec.memo).trim() }];
    }
    o._出どころ = 'コンパスヒヤリング';
    o._書き出し日時 = str(rec.更新);
    o._schema = 'okamura-hearing/1';
    return o;
  }
  function jsonText(rec, opt) { return JSON.stringify(json(rec, opt), null, 2); }

  // ── CSV（Hearing.csv と同じ列・同じ順） ───────────────────────
  function セル(v) {
    var t = 文字に(v);
    //  「"」はセルの中で2つに。区切り・改行・引用符があれば「"」で囲む
    if (/[",\n\r]/.test(t)) return '"' + t.replace(/"/g, function () { return '""'; }) + '"';
    return t;
  }
  /**
   * @param {object[]} recs 1件でも何件でも
   * @param {{BOMを付ける?:boolean}} [opt] Excel でそのまま開けるよう、既定で付ける
   */
  function csv(recs, opt) {
    opt = opt || {};
    var cols = F().csvCols;
    var 行 = [cols.map(セル).join(',')];
    (recs || []).forEach(function (rec) {
      var d = rec.data || {};
      var key = キー(rec);
      //  ★Hearing.csv は「物件番号」が2回出ます（先頭のキー列と、物件情報の欄）。
      //    コンパスのまま残してあるので、2回目も同じ値を入れます
      var 一度目 = true;
      行.push(cols.map(function (c) {
        if (c === '案件キー') return セル(key);
        if (c === '案件名') return セル(名前(rec));
        if (c === '更新日時') return セル(rec.更新);
        if (c === '物件番号') {
          if (一度目) { 一度目 = false; return セル(str(d['物件番号']).trim() || key); }
          return セル(d['物件番号']);
        }
        return セル(d[c]);
      }).join(','));
    });
    //  改行は CRLF（Excel が素直に読む）
    return (opt.BOMを付ける === false ? '' : BOM) + 行.join('\r\n') + '\r\n';
  }

  // ── 印刷用のHTML（PDF は「ブラウザの印刷 → PDFに保存」で作る） ──────
  //   ★自前でPDFを書くと日本語フォントの埋め込みが要ります（数MB）。
  //     コンパスの frame.print.js も同じ理由でブラウザの印刷を使っています。
  var esc = function (s) {
    return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  /**
   * 印刷用の中身（<div> の中身だけ。ページ全体ではない）
   * @param {object} rec
   * @param {{ぜんぶ?:boolean}} [opt]
   */
  function printHTML(rec, opt) {
    opt = opt || {};
    var d = rec.data || {};
    var h = [];
    h.push('<div class="pr-head">');
    h.push('<div class="pr-ttl">ヒヤリングシート</div>');
    h.push('<div class="pr-name">' + esc(名前(rec)) + '</div>');
    var 頭 = [];
    if (str(d['訪問日']).trim()) 頭.push('訪問日 ' + esc(d['訪問日']));
    if (str(d['社名']).trim()) 頭.push('社名 ' + esc(d['社名']));
    頭.push('作成 ' + esc(str(rec.更新).slice(0, 10)));
    h.push('<div class="pr-sub">' + 頭.join('　／　') + '</div>');
    h.push('</div>');

    F().stepsOf(!!opt.ぜんぶ).forEach(function (s) {
      var 行 = [];
      s.ids.forEach(function (id) {
        if (id === '物件名称' || id === '訪問日' || id === '社名') return;   // 頭に出している
        var f = F().get(id), t = 文字に(値(id, d));
        if (!t) return;
        行.push('<tr><th>' + esc(f ? f.label : id) + '</th><td>' + esc(t).replace(/\n/g, function () { return '<br>'; }) + '</td></tr>');
      });
      if (行.length) {
        h.push('<div class="pr-sect">' + esc(s.name) + '</div>');
        h.push('<table class="pr-tbl">' + 行.join('') + '</table>');
      }
    });

    var acts = (rec.actions || []).filter(function (a) { return str(a.action).trim(); });
    if (acts.length) {
      h.push('<div class="pr-sect">次の一手（アクション）</div>');
      h.push('<table class="pr-tbl pr-act"><tr><th>アクション</th><th>期日</th><th>状態</th></tr>');
      acts.forEach(function (a) {
        h.push('<tr><td>' + esc(a.action) + '</td><td>' + esc(a.when) + '</td><td>' + esc(a.st) + '</td></tr>');
      });
      h.push('</table>');
    }
    if (str(rec.memo).trim()) {
      h.push('<div class="pr-sect">打合せメモ（全文）</div>');
      h.push('<div class="pr-memo">' + esc(rec.memo).replace(/\n/g, function () { return '<br>'; }) + '</div>');
    }
    return h.join('');
  }

  // ── ファイル名 ──────────────────────────────────
  /** 使えない文字を落とす。長すぎる名前も切る */
  function ファイル名(rec, 拡張子) {
    var n = 名前(rec).replace(/[\\/:*?"<>|]/g, function () { return '_'; }).slice(0, 40);
    var 日 = str(rec.data && rec.data['訪問日']).trim() || str(rec.更新).slice(0, 10).replace(/[^0-9-]/g, function () { return ''; });
    return 'ヒヤリング_' + n + (日 ? '_' + 日 : '') + '.' + 拡張子;
  }

  var API = { json: json, jsonText: jsonText, csv: csv, printHTML: printHTML, ファイル名: ファイル名, キー: キー, 名前: 名前, 文字に: 文字に, BOM: BOM };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.EXPORT = API;
})(typeof self !== 'undefined' ? self : this);
