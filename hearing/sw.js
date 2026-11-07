/* sw.js ― オフラインで使えるようにする（Service Worker）
 *
 *   ★「ネットワークを先に、だめならキャッシュ」にしています。
 *     逆（キャッシュを先に）にすると、直したのに古い画面のままになり、
 *     作っている間ずっと「直らない」と悩むことになります。
 *     オフラインのときはキャッシュから出るので、飛行機の中でも入力できます。
 *
 *   ★外へは何も送りません。ここでやるのは、自分のファイルを預かることだけです。
 */
//  ★預かり場所の名前。頭の「compass-hearing-」が大事です。
//    GitHub Pages では、同じリポジトリの別のアプリ（コンパスノート）と
//    同じ置き場所（オリジン）を分け合います。掃除のとき、
//    この頭で始まるものだけを捨てます。でないと、よそのアプリの
//    オフライン用の預かり分まで消してしまいます。
var 頭 = 'compass-hearing-';
var 版 = 頭 + '2026-11-07e';
var ファイル = [
  './', './index.html', './app.css', './app.js',
  './fields.js', './extract.js', './inputs.js', './export.js', './loadsize.js',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(版).then(function (c) {
      //  1つでも落ちると全部失敗するので、1つずつ入れて、だめなものは飛ばす
      return Promise.all(ファイル.map(function (f) {
        return c.add(f).catch(function () { /* そのファイルは無くてもよい */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) {
        return k.indexOf(頭) === 0 && k !== 版;        // ★よそのアプリの分は触らない
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;        // 自分のファイルだけ
  //  ★自分の居るフォルダ（hearing/ など）の中だけ。
  //    よそのアプリ（root のコンパスノート）の読み込みには口を出しません。
  var 自分の場所 = location.pathname.replace(/[^/]*$/, function () { return ''; });
  if (url.pathname.indexOf(自分の場所) !== 0) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var 写し = res.clone();
        caches.open(版).then(function (c) { c.put(req, 写し); });
      }
      return res;
    }).catch(function () {
      return caches.open(版).then(function (c) { return c.match(req); }).then(function (hit) {
        if (hit) return hit;
        //  画面の読み込みなら、入口を返す（オフラインで深い URL を開いたとき）
        if (req.mode === 'navigate') return caches.open(版).then(function (c) { return c.match('./index.html'); });
        return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
