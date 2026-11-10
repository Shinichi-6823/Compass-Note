/* ============================================================================
 * app.js ― コンパスヒヤリング（スマホ用ヒヤリングシート）
 *
 *   画面は3つ: 一覧 ／ 入力（ステップ） ／ 出力
 *   保存は localStorage だけ。**外へ1バイトも送りません**（fetch も XHR も書いていません）
 *
 *   ★決めごと
 *     ・欄の定義は fields.js（コンパスの hearing.js から自動生成）。ここで欄名を書かない
 *     ・メモからの抽出は候補を出すだけ。**「使う」を押したときだけ**欄に入る（黙って入れ替えない）
 *     ・全文のメモは消さない（抽出は要約ではない）
 * ========================================================================== */
(function () {
  'use strict';

  var F = window.FIELDS, E = window.EXTRACT;
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  var str = function (v) { return String(v == null ? '' : v); };
  var KEY = 'ch1:';                       // localStorage の頭。版を上げるときはここ

  // ── 保存（localStorage） ─────────────────────────────
  var 倉庫 = {
    読む: function (k, 既定) {
      try { var s = localStorage.getItem(KEY + k); return s ? JSON.parse(s) : 既定; }
      catch (e) { return 既定; }
    },
    書く: function (k, v) {
      try { localStorage.setItem(KEY + k, JSON.stringify(v)); return true; }
      catch (e) { toast('保存できませんでした（端末の空きが足りないかもしれません）'); return false; }
    },
    消す: function (k) { try { localStorage.removeItem(KEY + k); } catch (e) {} }
  };
  var 一覧 = function () { return 倉庫.読む('idx', []) || []; };
  var 一覧書く = function (a) { return 倉庫.書く('idx', a); };

  // ── いまの状態 ───────────────────────────────────
  var S = {
    view: 'list',        // list / edit / out
    id: null,
    rec: null,           // { data:{}, actions:[], memo:'', 更新 }
    step: 0,
    ぜんぶ: false,
    cands: [],           // メモから拾った候補
    acands: [],          // 同 アクション
    使った: {},
    timer: null
  };

  var 今 = function () {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  var 新id = function () { return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };

  // ── ステップ（メモ ＋ fields.js のステップ） ──────────────
  function steps() {
    return [{ name: '打合せメモ', memo: true, ids: [] }].concat(F.stepsOf(S.ぜんぶ));
  }
  function 欄すべて() {
    var ids = [];
    F.stepsOf(S.ぜんぶ).forEach(function (s) { ids = ids.concat(s.ids); });
    return ids;
  }
  function 埋まり(rec) {
    var d = (rec && rec.data) || {}, n = 0, ids = [];
    F.stepsOf(false).forEach(function (s) { ids = ids.concat(s.ids); });
    ids.forEach(function (id) {
      var v = F.value ? F.value(id, d) : d[id];
      if (Array.isArray(v) ? v.length : str(v).trim()) n++;
    });
    return { n: n, 全: ids.length };
  }

  // ── 知らせ ─────────────────────────────────────
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  // ── 自動保存 ───────────────────────────────────
  function 汚れた() {
    追従();
    clearTimeout(S.timer);
    S.timer = setTimeout(保存, 400);              // 打つたびではなく、手が止まったら
  }
  /** 0次の答えが変わったら、それで決まる欄（社内版の derive）を描き直す（決まり方が変わったものだけ） */
  function 追従() {
    if (!F.follow || !S.rec) return;
    var box = document.getElementById('form');
    if (!box) return;
    box.querySelectorAll('[data-follow]').forEach(function (w) {
      var id = w.getAttribute('data-fid'), f = F.get(id);
      if (!f) return;
      if (JSON.stringify(F.follow(f, S.rec.data)) === w.getAttribute('data-sig')) return;
      w.parentNode.replaceChild(欄を作る(id), w);
    });
  }
  function 保存() {
    if (!S.id || !S.rec) return;
    S.rec.更新 = 今();
    if (!倉庫.書く('d:' + S.id, S.rec)) return;
    var a = 一覧(), e = a.find(function (x) { return x.id === S.id; });
    var m = 埋まり(S.rec);
    var 名 = str(S.rec.data['物件名称']).trim() || str(S.rec.data['社名']).trim() || '無題';
    if (!e) { e = { id: S.id }; a.unshift(e); }
    e.name = 名; e.訪問日 = str(S.rec.data['訪問日']); e.更新 = S.rec.更新; e.n = m.n; e.全 = m.全;
    a.sort(function (x, y) { return str(y.更新).localeCompare(str(x.更新)); });
    一覧書く(a);
  }

  // ── 画面を切り替える ───────────────────────────────
  function go(view, opt) {
    opt = opt || {};
    if (S.view === 'edit' && view !== 'edit') { clearTimeout(S.timer); 保存(); }
    S.view = view;
    if (view === 'edit') { S.step = opt.step != null ? opt.step : S.step; }
    描く();
    window.scrollTo(0, 0);
  }

  function 描く() {
    ['list', 'edit', 'out'].forEach(function (v) { $('v-' + v).classList.toggle('hide', v !== S.view); });
    if (S.view !== 'list') $('top-app').classList.add('hide');
    if (S.view === 'list') 一覧を描く();
    if (S.view === 'edit') 入力を描く();
    if (S.view === 'out') 出力を描く();
  }

  // ── ① 一覧 ─────────────────────────────────────
  function 一覧を描く() {
    $('top-title').textContent = document.title || 'コンパスヒヤリング';   // 社内版は「コンパスヒヤリング（社内）」（build が題を変える）
    $('top-sub').textContent = '打合せのヒヤリングを、この端末の中だけに保存します';
    $('top-left').classList.add('hide');
    $('top-right').classList.add('hide');
    //  コンパスノート（現場調査）へ（2026-11-09 利用者「ノートとヒヤリングに相互リンク」）。
    //  ノートは同じ公開先の1つ上（../）。file:// や Claude の中では行き先が無いので出さない
    $('top-app').classList.toggle('hide', location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname));
    $('dots').classList.add('hide');

    var box = $('list'); box.textContent = '';
    var a = 一覧();
    if (!a.length) {
      var e = el('div', 'empty');
      e.appendChild(el('div', null, 'まだ1件もありません。'));
      e.appendChild(el('div', null, '下の「＋ 新しく聞いた内容を入れる」から始めてください。'));
      box.appendChild(e);
      return;
    }
    a.forEach(function (x) {
      var c = el('div', 'card');
      var b = el('div', 'body');
      b.appendChild(el('div', 'ttl', x.name || '無題'));
      var 全 = x.全 || 45;
      b.appendChild(el('div', 'meta',
        (x.訪問日 ? '訪問 ' + x.訪問日 + '　' : '') + '更新 ' + str(x.更新).slice(5) + '　' + (x.n || 0) + '/' + 全 + ' 欄'));
      var g = el('div', 'gauge'), gi = el('span');
      gi.style.width = Math.round((x.n || 0) / 全 * 100) + '%';
      g.appendChild(gi); b.appendChild(g);
      c.appendChild(b);

      var del = el('button', 'del', '×');
      del.setAttribute('aria-label', x.name + ' を消す');
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!window.confirm('「' + (x.name || '無題') + '」を消します。元に戻せません。よろしいですか？')) return;
        倉庫.消す('d:' + x.id);
        一覧書く(一覧().filter(function (y) { return y.id !== x.id; }));
        描く(); toast('消しました');
      });
      c.appendChild(del);
      c.addEventListener('click', function () { 開く(x.id); });
      box.appendChild(c);
    });
  }

  function 新規() {
    S.id = 新id();
    S.rec = { data: {}, actions: [], memo: '', 更新: 今() };
    S.step = 0; S.cands = []; S.acands = []; S.使った = {};
    保存();
    go('edit', { step: 0 });
  }
  function 開く(id) {
    S.id = id;
    S.rec = 倉庫.読む('d:' + id, null);
    if (!S.rec) { toast('開けませんでした'); return; }
    if (!S.rec.data) S.rec.data = {};
    if (!S.rec.actions) S.rec.actions = [];
    if (読み替え(S.rec)) 保存();
    S.step = 0; S.cands = []; S.acands = []; S.使った = {};
    go('edit', { step: 0 });
  }
  /**
   * 前の版で入れた値を、いまの欄へ移す（fields.js の rename。入れ先が空のときだけ・元の欄は消す）。
   *   2026-11-09 競合・コンペの有無・コンペ競合 → 競合他社（競合有無）・競合他社名（競合社名）。移したら true
   */
  function 読み替え(rec) {
    var d = rec && rec.data, map = F.rename || {}, n = 0;
    if (!d) return false;
    Object.keys(map).forEach(function (from) {
      var v = d[from];
      if (v == null || (Array.isArray(v) ? !v.length : !str(v).trim())) { delete d[from]; return; }
      var to = map[from];
      if (!str(d[to]).trim()) d[to] = v;
      delete d[from]; n++;
    });
    return n > 0;
  }

  // ── ② 入力 ─────────────────────────────────────
  function 入力を描く() {
    var sp = steps(), st = sp[Math.min(S.step, sp.length - 1)];
    $('top-title').textContent = st.name;
    $('top-sub').textContent = (S.step + 1) + ' / ' + sp.length + '　' +
      (str(S.rec.data['物件名称']).trim() || str(S.rec.data['社名']).trim() || '無題');
    $('top-left').classList.remove('hide');
    $('top-left').textContent = '一覧';
    //  45欄だけで作った版（公開用）では、切り替えるものが無いのでボタンを出さない
    var 余分 = F.stepsOf(true).length > F.stepsOf(false).length;
    $('top-right').classList.toggle('hide', !余分);
    $('top-right').textContent = S.ぜんぶ ? '45欄' : 'ぜんぶ';

    var dots = $('dots'); dots.classList.remove('hide'); dots.textContent = '';
    sp.forEach(function (_, i) {
      var d = el('i');
      if (i === S.step) d.className = 'on'; else if (i < S.step) d.className = 'done';
      dots.appendChild(d);
    });

    var box = $('form'); box.textContent = '';
    if (st.memo) { メモを描く(box); }
    else {
      if (!st.既定) {
        var n = el('div', 'note', 'ここは「ぜんぶ表示」のときだけ出る欄です（' + st.tab + ' ＞ ' + st.name + '）。');
        box.appendChild(n);
      }
      st.ids.forEach(function (id) { box.appendChild(欄を作る(id)); });
      if (S.step === sp.length - 1 || st.name === '提出物・次の一手') アクションを描く(box);
    }

    $('b-prev').disabled = S.step === 0;
    $('b-next').textContent = S.step >= sp.length - 1 ? '出力へ' : '次へ →';
  }

  /** 欄ひとつ */
  function 欄を作る(id) {
    var f = F.get(id);
    if (!f) return el('div');
    var wrap = el('div', 'fld');
    //  社内版の「1回の答えで両方が埋まる欄」（fields.js の derive）。0次の答えで決まれば聞かない・選択肢を絞る
    if (f.derive && F.follow) {
      var w = F.follow(f, S.rec.data);
      wrap.className = 'fld follow';
      wrap.setAttribute('data-follow', f.derive.from);
      wrap.setAttribute('data-fid', id);
      wrap.setAttribute('data-sig', JSON.stringify(w));
      if (!w.show) {
        var fromF = F.get(f.derive.from);
        if (w.auto) wrap.appendChild(el('div', 'follow-auto', f.label + '：' + w.auto + '（「' + (fromF ? fromF.label : f.derive.from) + '」の答えから）'));
        else wrap.classList.add('hide');
        return wrap;
      }
      f = Object.assign({}, f, { opts: w.opts });
    }
    var lab = el('label');
    lab.appendChild(document.createTextNode(f.label));
    if (f.star) {
      var s = el('span', 'star', '★'.repeat(f.star));
      s.title = f.star === 3 ? '初回で確認' : f.star === 2 ? '初回以降で確認' : '提案までに確認';
      lab.appendChild(s);
    }
    if (f.k) {
      var k = el('span', 'kind k-' + f.k, { pre: '訪問前', z0: '0次', hard: '聞ければ', scr: '取捨選択' }[f.k]);
      lab.appendChild(k);
    }
    var inputId = 'f_' + id;
    lab.setAttribute('for', inputId);
    wrap.appendChild(lab);

    var v = S.rec.data[id];
    if (f.type === 'chk') {
      lab.removeAttribute('for');
      var cur = Array.isArray(v) ? v.slice() : [];
      var chips = el('div', 'chips');
      (f.opts || []).forEach(function (o) {
        var b = el('button', 'chip', o);
        b.type = 'button';
        b.setAttribute('aria-pressed', cur.indexOf(o) >= 0 ? 'true' : 'false');
        b.addEventListener('click', function () {
          var i = cur.indexOf(o);
          if (i >= 0) cur.splice(i, 1); else cur.push(o);
          b.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
          S.rec.data[id] = cur.slice();
          汚れた();
        });
        chips.appendChild(b);
      });
      wrap.appendChild(chips);
      return wrap;
    }
    if (f.type === 'sel') {
      var opts = (f.opts || []).filter(Boolean);
      lab.removeAttribute('for');
      if (opts.length <= 4) {
        var cs = el('div', 'chips');
        opts.forEach(function (o) {
          var b = el('button', 'chip', o);
          b.type = 'button';
          b.setAttribute('aria-pressed', str(v) === o ? 'true' : 'false');
          b.addEventListener('click', function () {
            var 同 = S.rec.data[id] === o;
            S.rec.data[id] = 同 ? '' : o;              // もう一度押すと外れる
            cs.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
            if (!同) b.setAttribute('aria-pressed', 'true');
            汚れた();
          });
          cs.appendChild(b);
        });
        wrap.appendChild(cs);
        return wrap;
      }
      var sel = el('select'); sel.id = inputId;
      lab.setAttribute('for', inputId);
      [''].concat(opts).forEach(function (o) {
        var op = el('option', null, o || '（選んでください）');
        op.value = o; if (str(v) === o) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { S.rec.data[id] = sel.value; 汚れた(); });
      wrap.appendChild(sel);
      return wrap;
    }
    if (f.type === 'area') {
      var ta = el('textarea'); ta.id = inputId; ta.rows = 4; ta.value = str(v);
      ta.addEventListener('input', function () { S.rec.data[id] = ta.value; 伸ばす(ta); 汚れた(); });
      wrap.appendChild(ta);
      setTimeout(function () { 伸ばす(ta); }, 0);
      return wrap;
    }
    //  ★数・時間・寸法・日付は、文字で打たせない（入れ方が fields.js に入っている）
    if (f.kind) return 入れ方で描く(f, wrap, inputId, lab);

    var inp = el('input'); inp.id = inputId;
    inp.type = f.type === 'date' ? 'date' : 'text';
    inp.value = str(v);
    if (f.ph) inp.placeholder = f.ph;          // 社内版の取捨選択の欄（例: 3億）
    inp.addEventListener('input', function () { S.rec.data[id] = inp.value; 汚れた(); });
    inp.addEventListener('change', function () { S.rec.data[id] = inp.value; 汚れた(); });
    wrap.appendChild(inp);
    return wrap;
  }

  /* ───────── 数・時間・寸法の入れ方 ─────────
   *   なぜ分けるか: iPhone のふつうのテキスト欄だと、かな入力になって
   *   「35」を出すだけで変換がいります。数字のキーボードを出せば変換はいりません。
   *
   *   ★収まらない文字は捨てません。「3000〜5000」のような値が来たら
   *     「文で書く」欄に切り替えて、打った文字をそのまま預かります。
   *   ★しまう文字は extract.js が拾う形と同じです（35名／08:00-17:00／600×400×300）。
   */
  function 入れ方で描く(f, wrap, inputId, lab) {
    var id = f.id;
    var 文で = false;                                  // この欄だけの状態
    var 箱 = el('div');
    var 切替 = el('button', 'pen'); 切替.type = 'button';

    lab.appendChild(切替);
    wrap.appendChild(箱);
    if (f.kind !== 'num' && f.kind !== 'date') lab.removeAttribute('for');

    var 文にする = function (t) {
      S.rec.data[id] = t; 汚れた();
      文で = true;
      toast('数字以外が入ったので、文で書く欄にしました');
      描く();
    };
    var 日付らしい = function (v) { return !v || /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v); };
    var 県らしい = function (v) { return !v || F.prefs.indexOf(v) >= 0; };
    //  その欄の形に収まるか。収まらなければ「文で書く」へ落とす（捨てない）
    var 読める = function (v) {
      if (f.kind === 'date') return { ok: 日付らしい(v) };
      if (f.kind === 'pref') return { ok: 県らしい(v) };
      if (f.kind === 'addr') return { ok: true };       // 住所はもともと文字
      return INPUTS.読み取る(f.kind, v);
    };

    function 描く() {
      箱.textContent = '';
      var v = str(S.rec.data[id]);
      var 部 = 読める(v);
      if (!部.ok) 文で = true;                          // 収まらない文字が入っている
      切替.classList.toggle('hide', f.kind === 'addr');  // 住所に逃げ道はいらない
      切替.textContent = 文で ? (f.kind === 'pref' || f.kind === 'date' ? '⌨ 選ぶ' : '⌨ 数字で') : '✎ 文で';
      切替.setAttribute('aria-label', 文で ? 'もとの入れ方に戻す' : '当てはまらないことを文で書く');
      if (文で) return 文の箱(f, 箱, inputId);
      if (f.kind === 'num') return 数の箱(f, 箱, inputId, 部, 文にする);
      if (f.kind === 'span') return 時間の箱(f, 箱, inputId, 部);
      if (f.kind === 'dim') return 寸法の箱(f, 箱, inputId, 部, 文にする);
      if (f.kind === 'pref') return 県の箱(f, 箱, inputId);
      if (f.kind === 'addr') return 住所の箱(f, 箱, inputId);
      return 日付の箱(f, 箱, inputId);
    }

    切替.addEventListener('click', function () {
      if (文で) {
        if (!読める(str(S.rec.data[id])).ok) {
          toast('いまの文字はもとの入れ方に収まりません。消してから切り替えてください'); return;
        }
        文で = false;
      } else { 文で = true; }
      描く();
    });

    描く();
    return wrap;
  }

  /** 文で書く（範囲・注記・「月内」など）。数字の箱に収まらない値はここで預かる */
  function 文の箱(f, 箱, inputId) {
    var inp = el('input'); inp.id = inputId; inp.type = 'text';
    inp.value = str(S.rec.data[f.id]);
    inp.placeholder = f.kind === 'pref' ? '例）オンライン（Teams）' :
      f.kind === 'date' ? '例）11月中' :
      f.kind === 'span' ? '例）8時〜17時（2交替）' :
        f.kind === 'dim' ? '例）600×400（高さは聞けず）' : '例）3000〜5000';
    inp.addEventListener('input', function () { S.rec.data[f.id] = inp.value; 汚れた(); });
    箱.appendChild(inp);
    箱.appendChild(el('div', 'readback', '文で書いています。コンパスへはこの文字のまま入ります。'));
    setTimeout(function () {
      try { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
    }, 0);
  }

  /** 日付を選ぶ（図面・提案書の希望提出日。コンパスも日付として読む欄） */
  function 日付の箱(f, 箱, inputId) {
    var d = el('input'); d.id = inputId; d.type = 'date'; d.value = str(S.rec.data[f.id]);
    var 直す = function () { S.rec.data[f.id] = d.value; 汚れた(); };
    d.addEventListener('input', 直す); d.addEventListener('change', 直す);
    箱.appendChild(d);
    箱.appendChild(el('div', 'readback', '日が決まっていなければ「✎ 文で」から言葉で書けます。'));
  }

  /** 数＋単位。［ 3000 ］［ ケース ▾ ］と、下に読み返し */
  function 数の箱(f, 箱, inputId, 部, 文にする) {
    var id = f.id;
    var row = el('div', 'numrow');
    var inp = el('input'); inp.id = inputId; inp.type = 'text'; inp.className = 'num';
    inp.inputMode = f.imode || 'numeric';              // ★ここで数字のキーボードになる
    inp.autocomplete = 'off';
    inp.setAttribute('enterkeyhint', 'done');
    inp.placeholder = '数';
    inp.value = 部.数;
    row.appendChild(inp);

    var 単位 = 部.単位 || '', sel = null;
    if (f.単位たち && f.単位たち.length) {
      sel = el('select', 'unitsel');
      var 並び = f.単位たち.slice();
      if (単位 && 並び.indexOf(単位) < 0) 並び.unshift(単位);   // 拾ってきた単位も消さない
      [''].concat(並び).forEach(function (u) {
        var op = el('option', null, u || '単位');
        op.value = u; if (u === 単位) op.selected = true;
        sel.appendChild(op);
      });
      row.appendChild(sel);
    } else if (f.単位) {
      単位 = f.単位;                                    // 名・行（動かない単位）
      row.appendChild(el('span', 'unit', 単位));
    } else if (f.そえ) {
      row.appendChild(el('span', 'unit', f.そえ));      // kg・千円（しまう文字には入れない）
    }
    箱.appendChild(row);

    var 読み = el('div', 'readback');
    箱.appendChild(読み);

    function 読み返し() {
      var n = inp.value.trim();
      if (!n) { 読み.textContent = ''; return; }
      var t = INPUTS.区切る(n) + (単位 || f.そえ || '');
      if (f.円) { var y = INPUTS.円に(n); if (y) t += '　≒ ' + y; }
      読み.textContent = t;
    }
    function しまう() {
      S.rec.data[id] = INPUTS.組み立てる('num', { 数: inp.value.trim(), 単位: 単位 });
      汚れた(); 読み返し();
    }

    inp.addEventListener('input', function () {
      var t = INPUTS.ならす(inp.value);
      if (!INPUTS.数だけ(t)) return 文にする(t + (単位 || ''));   // ★捨てずに文へ送る
      if (t !== inp.value) inp.value = t;                        // 全角で来たら半角に直す
      しまう();
    });
    if (sel) sel.addEventListener('change', function () { 単位 = sel.value; しまう(); });
    読み返し();
  }

  /** 時間帯。［ 08:00 ］〜［ 17:00 ］（時計で選ぶので、打ちません） */
  function 時間の箱(f, 箱, inputId, 部) {
    var id = f.id;
    var row = el('div', 'spanrow');
    var a = el('input'); a.type = 'time'; a.id = inputId; a.step = '300'; a.value = 部.時1;
    var b = el('input'); b.type = 'time'; b.step = '300'; b.value = 部.時2;
    row.appendChild(a); row.appendChild(el('span', 'tilde', '〜')); row.appendChild(b);
    箱.appendChild(row);
    var 読み = el('div', 'readback');
    箱.appendChild(読み);

    function 見せる() {
      var v = str(S.rec.data[id]);
      if (!v) { 読み.textContent = '片方だけでもかまいません（〆切の時間など）。'; return; }
      var h = 長さ(a.value, b.value);
      読み.textContent = v + (h ? '（' + h + '）' : '');
    }
    function しまう() {
      S.rec.data[id] = INPUTS.組み立てる('span', { 時1: a.value, 時2: b.value });
      汚れた(); 見せる();
    }
    a.addEventListener('change', しまう); b.addEventListener('change', しまう);
    a.addEventListener('input', しまう); b.addEventListener('input', しまう);
    見せる();
  }
  /** 08:00〜17:00 → 「9時間」。打ち間違いに気づくための読み返し */
  function 長さ(a, b) {
    var 分 = function (s) {
      var m = /^([0-9]{1,2}):([0-9]{2})$/.exec(str(s)); return m ? +m[1] * 60 + +m[2] : null;
    };
    var x = 分(a), y = 分(b);
    if (x == null || y == null) return '';
    var d = y - x; if (d < 0) d += 24 * 60;             // 夜をまたぐ場合
    if (!d) return '';
    return (d % 60 ? (d / 60).toFixed(1) : String(d / 60)) + '時間';
  }

  /** 寸法。［ W ］×［ L ］×［ H ］（×を打たせない） */
  function 寸法の箱(f, 箱, inputId, 部, 文にする) {
    var id = f.id;
    var row = el('div', 'dimrow');
    var 名 = ['W', 'L', 'H'], 箱s = [];
    名.forEach(function (nm, i) {
      if (i) row.appendChild(el('span', 'times', '×'));
      var inp = el('input'); inp.type = 'text'; inp.className = 'num';
      inp.inputMode = f.imode || 'numeric';
      inp.autocomplete = 'off';
      inp.setAttribute('enterkeyhint', 'done');
      inp.placeholder = nm;
      inp.value = 部.寸[i] || '';
      if (!i) inp.id = inputId;
      inp.addEventListener('input', function () {
        var t = INPUTS.ならす(inp.value);
        if (!INPUTS.数だけ(t)) {
          //  ★打った文字をぜんぶ残して文へ送る
          var 部品 = 箱s.map(function (x) { return x.value.trim(); });
          部品[i] = t;
          return 文にする(部品.filter(Boolean).join('×'));
        }
        if (t !== inp.value) inp.value = t;
        しまう();
      });
      箱s.push(inp);
      row.appendChild(inp);
    });
    if (f.そえ) row.appendChild(el('span', 'unit', f.そえ));
    箱.appendChild(row);

    var 読み = el('div', 'readback');
    箱.appendChild(読み);

    function しまう() {
      var v = INPUTS.組み立てる('dim', { 寸: 箱s.map(function (x) { return x.value.trim(); }) });
      if (v === null) {                                 // 間が空いている（W と H だけ など）
        読み.textContent = 'まん中（L）が空いています。順に入れてください。';
        return;
      }
      S.rec.data[id] = v; 汚れた(); 見せる();
    }
    function 見せる() {
      var v = str(S.rec.data[id]);
      読み.textContent = v ? v + (f.そえ || '') : '聞けたところまででかまいません（W だけ・W×L だけ）。';
    }
    見せる();
  }

  /** 県名を47から選ぶ（打合せ場所。オンラインなどは「✎ 文で」） */
  function 県の箱(f, 箱, inputId) {
    var sel = el('select'); sel.id = inputId;
    var v = str(S.rec.data[f.id]);
    [''].concat(F.prefs).forEach(function (o) {
      var op = el('option', null, o || '（選んでください）');
      op.value = o; if (o === v) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () { S.rec.data[f.id] = sel.value; 汚れた(); });
    箱.appendChild(sel);
  }

  /* 住所（納地）。
   *   ★郵便番号7桁 → 住所。コンパス（detail.js の fillFromZip）と同じ zipcloud を使います。
   *     キーは要りません。外へ出るのは7桁の数字だけで、社名も住所も送りません。
   *     押したときだけ動きます（打つたびには送りません）。オフラインなら手で書けます。
   *   ★地図は「開くだけ」。ページの中に地図を埋めるとAPIキーが要り、
   *     公開リポジトリに鍵を置くことになります。コンパスも同じ理由で同じ作りです。
   */
  function 住所の箱(f, 箱, inputId) {
    var id = f.id;

    //  ① 郵便番号（この欄は控えません。住所を引くための道具です）
    var row = el('div', 'numrow');
    var zip = el('input'); zip.type = 'text'; zip.className = 'num';
    zip.inputMode = 'numeric';                         // ★ここも数字キーボード
    zip.autocomplete = 'off';
    zip.setAttribute('enterkeyhint', 'search');
    zip.placeholder = '郵便番号（7桁）';
    zip.setAttribute('aria-label', '郵便番号7桁');
    var go = el('button', 'mini', '住所を入れる'); go.type = 'button';
    row.appendChild(zip); row.appendChild(go);
    箱.appendChild(row);

    var 知らせ = el('div', 'readback');
    箱.appendChild(知らせ);

    //  ② 住所そのもの（コンパスへは、この文字がそのまま入ります）
    var inp = el('input'); inp.id = inputId; inp.type = 'text';
    inp.value = str(S.rec.data[id]);
    inp.placeholder = '例）東京都調布市布田1-2-3';
    inp.addEventListener('input', function () { S.rec.data[id] = inp.value; 汚れた(); 地図を出す(); });
    箱.appendChild(inp);

    //  ③ 地図で開く（押したときだけ。Googleマップの画面へ行きます）
    var 地図 = el('button', 'btn sub', '🗺 Googleマップで開く');
    地図.type = 'button';
    地図.style.margin = '8px 0 0';
    地図.addEventListener('click', function () {
      var q = inp.value.trim();
      if (!q) { toast('先に住所か郵便番号を入れてください'); return; }
      window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q), '_blank');
    });
    箱.appendChild(地図);
    function 地図を出す() { 地図.classList.toggle('hide', !inp.value.trim()); }
    地図を出す();

    //  郵便番号から引く
    function 引く() {
      var z = INPUTS.ならす(zip.value).replace(/[^0-9]/g, function () { return ''; });
      if (z.length !== 7) { 知らせ.textContent = '郵便番号は7桁で入れてください。'; return; }
      知らせ.textContent = '郵便番号から住所を調べています…';
      go.disabled = true;
      fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + z).then(function (r) {
        return r.json();
      }).then(function (j) {
        var a = j && j.results && j.results[0];
        if (!a) { 知らせ.textContent = 'その郵便番号の住所が見つかりませんでした。'; return; }
        var 住所 = str(a.address1) + str(a.address2) + str(a.address3);
        if (!inp.value.trim()) {                       // 空なら、そのまま入れる
          inp.value = 住所; S.rec.data[id] = 住所; 汚れた(); 地図を出す();
          知らせ.textContent = '入れました: ' + 住所 + '（番地はこのあと足してください）';
          return;
        }
        //  ★すでに書いてあるものは、黙って入れ替えない（押したときだけ差し替える）
        知らせ.textContent = '';
        var 候 = el('div', 'cand');
        var b = el('div', 'c-body');
        b.appendChild(el('div', 'c-lab', '郵便番号から'));
        b.appendChild(el('div', 'c-val', 住所));
        var 使う = el('button', null, '入れ替える'); 使う.type = 'button';
        使う.addEventListener('click', function () {
          inp.value = 住所; S.rec.data[id] = 住所; 汚れた(); 地図を出す();
          知らせ.textContent = '入れ替えました: ' + 住所;
        });
        候.appendChild(b); 候.appendChild(使う);
        知らせ.appendChild(候);
      }).catch(function () {
        知らせ.textContent = 'オフラインか、社内から外に出られないようです。住所は手で書けます。';
      }).then(function () { go.disabled = false; });
    }
    go.addEventListener('click', 引く);
    zip.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); 引く(); } });
  }

  function 伸ばす(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 96) + 'px';
  }

  // ── 打合せメモ（音声入力）と、そこからの抽出 ──────────────
  function メモを描く(box) {
    box.appendChild(el('div', 'note',
      'iPhone のキーボードの 🎤 を押して、打合せの内容をそのまま話してください。' +
      'あとで「メモから項目を拾う」を押すと、拾えた項目が候補として出ます。' +
      'メモはそのまま残るので、拾えなかった話が消えることはありません。'));

    var ta = el('textarea', 'memo');
    ta.id = 'memo';
    ta.placeholder = '例）架空商事の東京DCで打合せ。倉庫機能はDC。課題は人手不足と保管スペース不足。荷姿は入荷パレット、出荷ケース。ケースは600×400×300で15キロ…';
    ta.value = str(S.rec.memo);
    ta.addEventListener('input', function () { S.rec.memo = ta.value; 伸ばす(ta); 汚れた(); });
    box.appendChild(ta);
    setTimeout(function () { 伸ばす(ta); }, 0);

    var b = el('button', 'btn', '✨ メモから項目を拾う');
    b.type = 'button';
    b.style.marginTop = '12px';
    b.addEventListener('click', function () {
      var t = str(S.rec.memo);
      if (!t.trim()) { toast('先にメモを書いてください'); return; }
      S.cands = E.拾う(t);
      S.acands = E.アクション(t);
      S.使った = {};
      // ぜんぶ表示でない場合、45欄の外の候補は出さない（入れても見えないため）
      var 既定 = {};
      F.stepsOf(false).forEach(function (s) { s.ids.forEach(function (id) { 既定[id] = 1; }); });
      if (!S.ぜんぶ) S.cands = S.cands.filter(function (c) { return 既定[c.id]; });
      候補を描く();
      toast(S.cands.length + S.acands.length ? '候補を ' + (S.cands.length + S.acands.length) + ' 件拾いました'
                                             : '拾えるものがありませんでした');
    });
    box.appendChild(b);
    var holder = el('div'); holder.id = 'cands';           // 候補の置き場所
    box.appendChild(holder);
    if (S.cands.length || S.acands.length) 候補を描く();
  }

  function 候補を描く() {
    var holder = $('cands');
    if (!holder) return;
    holder.textContent = '';
    if (!S.cands.length && !S.acands.length) return;

    var box = el('div', 'cands');
    box.appendChild(el('h3', null, '拾えた候補　' + (S.cands.length + S.acands.length) + '件（押すと欄に入ります）'));

    S.cands.forEach(function (c, i) {
      var f = F.get(c.id);
      var row = el('div', 'cand');
      var b = el('div', 'c-body');
      b.appendChild(el('div', 'c-lab', (f && f.label) || c.id));
      b.appendChild(el('div', 'c-val', Array.isArray(c.value) ? c.value.join('／') : str(c.value)));
      if (c.元) b.appendChild(el('div', 'c-src', '「' + c.元 + '」'));
      row.appendChild(b);
      var btn = el('button', null, S.使った['c' + i] ? '入れました' : '使う');
      btn.type = 'button';
      btn.disabled = !!S.使った['c' + i];
      btn.addEventListener('click', function () {
        使う(c); S.使った['c' + i] = true;
        btn.textContent = '入れました'; btn.disabled = true;
        toast(((f && f.label) || c.id) + ' に入れました');
      });
      row.appendChild(btn);
      box.appendChild(row);
    });

    S.acands.forEach(function (a, i) {
      var row = el('div', 'cand');
      var b = el('div', 'c-body');
      b.appendChild(el('div', 'c-lab', '次の一手（アクション）'));
      b.appendChild(el('div', 'c-val', a.action));
      if (a.when) b.appendChild(el('div', 'c-src', 'スケジュール ' + a.when));
      row.appendChild(b);
      var btn = el('button', null, S.使った['a' + i] ? '入れました' : '使う');
      btn.type = 'button';
      btn.disabled = !!S.使った['a' + i];
      btn.addEventListener('click', function () {
        S.rec.actions.push({ phase: '0次提案', action: a.action, todo: '', when: a.when || '', who: '', pri: '', st: '未着手', note: '' });
        汚れた();
        S.使った['a' + i] = true;
        btn.textContent = '入れました'; btn.disabled = true;
        toast('アクションに1行足しました');
      });
      row.appendChild(btn);
      box.appendChild(row);
    });

    var all = el('button', 'btn sub', 'ぜんぶ使う（' + (S.cands.length + S.acands.length) + '件）');
    all.type = 'button'; all.style.margin = '12px';
    all.style.width = 'calc(100% - 24px)';
    all.addEventListener('click', function () {
      S.cands.forEach(function (c, i) { if (!S.使った['c' + i]) { 使う(c); S.使った['c' + i] = true; } });
      S.acands.forEach(function (a, i) {
        if (S.使った['a' + i]) return;
        S.rec.actions.push({ phase: '0次提案', action: a.action, todo: '', when: a.when || '', who: '', pri: '', st: '未着手', note: '' });
        S.使った['a' + i] = true;
      });
      汚れた(); 候補を描く();
      toast('ぜんぶ入れました');
    });
    box.appendChild(all);
    holder.appendChild(box);
  }

  function 使う(c) {
    S.rec.data[c.id] = Array.isArray(c.value) ? c.value.slice() : c.value;
    汚れた();
  }

  // ── アクションの表 ───────────────────────────────
  function アクションを描く(box) {
    box.appendChild(el('div', 'sect', '次の一手（アクション）'));
    var holder = el('div'); holder.id = 'acts';
    box.appendChild(holder);
    アクション一覧(holder);
    var add = el('button', 'btn sub', '＋ アクションを足す');
    add.type = 'button';
    add.addEventListener('click', function () {
      S.rec.actions.push({ phase: '0次提案', action: '', todo: '', when: '', who: '', pri: '', st: '未着手', note: '' });
      汚れた(); アクション一覧(holder);
    });
    box.appendChild(add);
  }
  function アクション一覧(holder) {
    holder.textContent = '';
    if (!S.rec.actions.length) {
      holder.appendChild(el('div', 'note', 'まだありません。打合せメモから拾うか、下の「＋」で足してください。'));
      return;
    }
    S.rec.actions.forEach(function (a, i) {
      var c = el('div', 'act');
      var r1 = el('div', 'r');
      var inp = el('input'); inp.type = 'text'; inp.value = str(a.action); inp.placeholder = 'アクション';
      inp.addEventListener('input', function () { a.action = inp.value; 汚れた(); });
      r1.appendChild(inp);
      var x = el('button', 'x', '×'); x.type = 'button';
      x.setAttribute('aria-label', 'このアクションを消す');
      x.addEventListener('click', function () { S.rec.actions.splice(i, 1); 汚れた(); アクション一覧(holder); });
      r1.appendChild(x);
      c.appendChild(r1);

      var r2 = el('div', 'r');
      var d = el('input'); d.type = 'date'; d.value = str(a.when);
      d.addEventListener('change', function () { a.when = d.value; 汚れた(); });
      r2.appendChild(d);
      var st = el('select');
      ['未着手', '進行中', '完了', '遅延'].forEach(function (o) {
        var op = el('option', null, o); op.value = o; if (str(a.st) === o) op.selected = true;
        st.appendChild(op);
      });
      st.addEventListener('change', function () { a.st = st.value; 汚れた(); });
      r2.appendChild(st);
      c.appendChild(r2);
      holder.appendChild(c);
    });
  }

  // ── ③ 出力 ─────────────────────────────────────
  function 出力を描く() {
    $('top-title').textContent = '出力';
    $('top-sub').textContent = str(S.rec && S.rec.data['物件名称']).trim() || str(S.rec && S.rec.data['社名']).trim() || '無題';
    $('top-left').classList.remove('hide'); $('top-left').textContent = '戻る';
    $('top-right').classList.add('hide');
    $('dots').classList.add('hide');

    var m = 埋まり(S.rec);
    $('out-sum').textContent = m.全 + '欄のうち ' + m.n + ' 欄が埋まっています。';
  }

  /** メール・Teams に貼る素のテキスト。空欄は出さない */
  function テキスト() {
    var d = S.rec.data, out = [];
    var 名 = str(d['物件名称']).trim() || str(d['社名']).trim() || '無題';
    out.push('【ヒヤリング】' + 名);
    if (str(d['訪問日']).trim()) out.push('訪問日: ' + d['訪問日']);
    F.stepsOf(S.ぜんぶ).forEach(function (s) {
      var 行 = [];
      s.ids.forEach(function (id) {
        var f = F.get(id), v = F.value ? F.value(id, d) : d[id];   // 社内版の derive は 0次の答えで決まった値
        var t = Array.isArray(v) ? v.join('／') : str(v).trim();
        if (!t) return;
        if (id === '物件名称' || id === '訪問日') return;         // 頭に出しているので重ねない
        行.push((f ? f.label : id) + ': ' + t);
      });
      if (行.length) { out.push('', '■ ' + s.name, 行.join('\n')); }
    });
    var acts = (S.rec.actions || []).filter(function (a) { return str(a.action).trim(); });
    if (acts.length) {
      out.push('', '■ 次の一手');
      acts.forEach(function (a) {
        out.push('・' + a.action + (a.when ? '（' + a.when + '）' : '') + (a.st ? ' [' + a.st + ']' : ''));
      });
    }
    if (str(S.rec.memo).trim()) out.push('', '■ 打合せメモ（全文）', str(S.rec.memo).trim());
    return out.join('\n');
  }

  function コピー(t, 済) {
    var ok = function () { toast(済 || 'コピーしました'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(ok, function () { 選んでコピー(t, ok); });
    } else 選んでコピー(t, ok);
  }
  function 選んでコピー(t, ok) {
    var ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.setSelectionRange(0, ta.value.length);
    try { document.execCommand('copy'); ok(); }
    catch (e) { toast('コピーできませんでした。下に出した文を長押しで選んでください'); 下に出す(t); }
    ta.remove();
  }
  function 下に出す(t) {
    var pre = $('out-text');
    pre.textContent = t; pre.classList.remove('hide');
  }

  // ── 書き出し（ファイルを渡す） ───────────────────────────
  /**
   * ファイルを渡す。
   * ★iPhone では「共有シート」が本命です（ファイルに保存・メールに添付・Teams へ）。
   *   ホーム画面のアプリでは <a download> が効かないことがあるため。
   *   共有が使えない端末では、今までどおりダウンロードに落とします。
   */
  function 渡す(text, name, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var file = null;
    try { file = new File([blob], name, { type: mime }); } catch (e) { /* File が無い端末 */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file], title: name })
        .then(function () { toast('渡しました'); })
        .catch(function (e) { if (e && e.name !== 'AbortError') 落とす(blob, name); });
      return;
    }
    落とす(blob, name);
  }
  function 落とす(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('書き出しました');
  }

  /** 印刷（PDF）。中身を #print に入れてから、ブラウザの印刷を呼ぶ */
  function 印刷() {
    $('print').innerHTML = window.EXPORT.printHTML(S.rec, { ぜんぶ: S.ぜんぶ });
    setTimeout(function () {
      try { window.print(); }
      catch (e) { toast('印刷を開けませんでした'); }
    }, 60);
  }

  // ── 結線 ───────────────────────────────────────
  function 結ぶ() {
    $('b-new').addEventListener('click', 新規);
    $('top-left').addEventListener('click', function () {
      if (S.view === 'out') go('edit'); else go('list');
    });
    $('top-right').addEventListener('click', function () {
      S.ぜんぶ = !S.ぜんぶ;
      if (S.step >= steps().length) S.step = steps().length - 1;
      描く();
      toast(S.ぜんぶ ? 'ぜんぶの欄を出します' : '45欄だけにしました');
    });
    $('b-prev').addEventListener('click', function () {
      if (S.step > 0) { S.step--; 描く(); window.scrollTo(0, 0); }
    });
    $('b-next').addEventListener('click', function () {
      var n = steps().length;
      if (S.step >= n - 1) { 保存(); go('out'); return; }
      S.step++; 描く(); window.scrollTo(0, 0);
    });
    $('b-copy').addEventListener('click', function () { コピー(テキスト()); });
    $('b-show').addEventListener('click', function () { 下に出す(テキスト()); });
    $('b-back').addEventListener('click', function () { go('list'); });
    $('b-pdf').addEventListener('click', 印刷);
    $('b-json').addEventListener('click', function () {
      var X = window.EXPORT;
      渡す(X.jsonText(S.rec), X.ファイル名(S.rec, 'json'), 'application/json');
    });
    $('b-csv').addEventListener('click', function () {
      var X = window.EXPORT;
      渡す(X.csv([S.rec]), X.ファイル名(S.rec, 'csv'), 'text/csv');
    });
    $('b-csv-all').addEventListener('click', function () {
      var a = 一覧();
      if (!a.length) { toast('まだ1件もありません'); return; }
      var recs = a.map(function (x) { var r = 倉庫.読む('d:' + x.id, null); 読み替え(r); return r; })
        .filter(function (r) { return r && r.data; });
      if (!recs.length) { toast('読めませんでした'); return; }
      var 日 = 今().slice(0, 10);
      渡す(window.EXPORT.csv(recs), 'ヒヤリング_' + recs.length + '件_' + 日 + '.csv', 'text/csv');
    });

    キーボードを見張る();

    // 閉じるときは、待たずにその場で保存する
    window.addEventListener('pagehide', function () { clearTimeout(S.timer); 保存(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { clearTimeout(S.timer); 保存(); }
    });
  }

  /**
   * キーボードが出ている高さを --kb に入れる。
   *
   * ★なぜ要るか: iOS でキーボードが出ても、ページの高さ（innerHeight）は変わりません。
   *   position:fixed の下の帯は**キーボードの裏**に回って押せなくなります。
   *   実機は iPhone SE（縦 549px）なので、キーボードが出ると見えるのは 250px ほどです。
   * ★visualViewport が無い端末では何もしません（帯は今までどおり下に貼り付く）。
   */
  function キーボードを見張る() {
    var vv = window.visualViewport;
    if (!vv) return;
    var 合わせる = function () {
      var 下 = window.innerHeight - (vv.height + vv.offsetTop);
      //  80px 未満は、アドレスバーの出入りなど。キーボードとは見なさない
      var kb = 下 > 80 ? Math.round(下) : 0;
      document.documentElement.style.setProperty('--kb', kb + 'px');
      document.body.classList.toggle('kb', kb > 0);
    };
    vv.addEventListener('resize', 合わせる);
    vv.addEventListener('scroll', 合わせる);
    合わせる();
  }

  // ── 立ち上げ ───────────────────────────────────
  function 立ち上げ() {
    if (!F || !E) {
      document.body.textContent = '部品を読み込めませんでした（fields.js / extract.js）。';
      return;
    }
    結ぶ();
    描く();
    //  ★localhost も通します（手元でオフラインの動きを確かめられるように）
    var 安全な場所 = location.protocol === 'https:' || location.hostname === 'localhost';
    if ('serviceWorker' in navigator && 安全な場所) {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 失敗しても使える */ });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', 立ち上げ);
  else 立ち上げ();

  window.__CH = { S: S, 倉庫: 倉庫, テキスト: テキスト, steps: steps, 埋まり: 埋まり, 読み替え: 読み替え };   // 検査から触る
})();
