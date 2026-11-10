/* sw.js ― コンパスAR を電波の弱い所でも開けるようにする（Service Worker）
 *
 *   ★「ネットワークを先に、だめならしまったもの」。逆にすると、直したのに古い画面のままになる。
 *   ★外へは何も送らない。ここでやるのは、自分のファイル（画面と three.js）をしまっておくことだけ。
 *   ★選んだ 3D のファイルはしまわない（端末のメモリの中で読むだけ）。
 */
//  ★しまう場所の名前の頭「compass-ar-」が大事。GitHub Pages では、同じリポジトリの
//    ほかのアプリ（コンパスノート・コンパスヒヤリング）と同じ置き場所（オリジン）を分け合う。
//    掃除のときは、この頭で始まるものだけを捨てる。
var 頭 = 'compass-ar-';
var 版 = 頭 + '2026.11.10-475301d3';      // build-arapp.mjs が「版（casedb の BUILD）＋中身の指紋」を入れる
var ファイル = ["./","./app.css","./app.js","./icon-180.png","./icon-192.png","./icon-512.png","./index.html","./manifest.webmanifest","./model.js","./vendor/LICENSE-three.txt","./vendor/addons/controls/OrbitControls.js","./vendor/addons/exporters/USDZExporter.js","./vendor/addons/libs/fflate.module.js","./vendor/addons/loaders/GLTFLoader.js","./vendor/addons/loaders/MTLLoader.js","./vendor/addons/loaders/OBJLoader.js","./vendor/addons/utils/BufferGeometryUtils.js","./vendor/addons/utils/TextureUtils.js","./vendor/three.module.min.js"];      // build-arapp.mjs が出すファイルの一覧を入れる

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(版).then(function (c) {
      return Promise.all(ファイル.map(function (f) {
        return c.add(f).catch(function () { /* 1つ落ちても続ける */ });
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
  if (url.origin !== location.origin) return;
  //  ★自分のフォルダ（ar/）の中だけ。よそのアプリの読み込みには口を出さない
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
        if (req.mode === 'navigate') return caches.open(版).then(function (c) { return c.match('./index.html'); });
        return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
