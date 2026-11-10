/* コンパスノートの Service Worker（build-note.mjs が作る。手で直さない）版 2026.11.10-cc20c8b0 */
const CACHE = 'compass-note-2026.11.10-cc20c8b0';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('compass-note-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
//  ページ（index.html）は「電波があれば新しい版・3秒待っても来なければ、しまった版」。そのほかは しまった版を先に
//  ★自分のフォルダの直下だけ（2026-11-10）。同じリポジトリの hearing/・ar/ はそれぞれのアプリのもの。
//    前は下のフォルダのページも受け持ち、初めて開いた hearing/・ar/ のページを「ノートの index.html」としてしまい直していた
//    （電波の無い所でノートを開くとヒヤリングや AR が出る・電波が遅いとリンク先でノートが出る）
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const path = new URL(req.url).pathname, base = new URL(self.registration.scope).pathname;
  if (!path.startsWith(base) || path.slice(base.length).includes('/')) return;
  const page = req.mode === 'navigate' || /\/(index\.html)?$/.test(path);
  if (page) {
    e.respondWith(new Promise(res => {
      let done = false; const fall = () => caches.match('index.html').then(r => r || caches.match('./')).then(r => { if (!done && r) { done = true; res(r); } });
      const t = setTimeout(fall, 3000);
      fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put('index.html', cp)); } clearTimeout(t); if (!done) { done = true; res(r); } })
        .catch(() => { clearTimeout(t); fall().then(() => { if (!done) { done = true; res(new Response('オフラインで、まだ端末にしまっていません。一度電波のある所で開いてください', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })); } }); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
