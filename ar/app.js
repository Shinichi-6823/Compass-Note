/* app.js ― コンパスAR（Matelier 3D の OBJ をスマホの AR で置いて見る）
 *
 *   ① ファイルを選ぶ（OneDrive・SharePoint は端末の「ファイルを選択」から）→ model.js が読んで色ごとにまとめる
 *   ② 形を確かめる（指で回せる 3D）・単位（mm／m）・上下
 *   ③ 置く大きさ（原寸・机の上・1/10・1/50・1/100）
 *   ④ AR で見る
 *       iPhone・iPad＝AR Quick Look（その場で USDZ に直して <a rel="ar"> で開く。Safari で）
 *       Android＝WebXR の immersive-ar（Chrome。床を映して輪が出たらタップで置く）
 *
 *   ★外へは何も送らない。読むのも USDZ を作るのも、この端末の中だけ。
 */
import * as THREE from 'three';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { USDZExporter } from './vendor/addons/exporters/USDZExporter.js';
import { readFiles, mergeByMaterial, fitMatrix, unitFromSize } from './model.js';

const $ = (s) => document.querySelector(s);
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** AR Quick Look が使えるか（iPhone の Safari。アプリの中の画面＝Teams・SharePoint などでは false のことが多い） */
const QUICKLOOK = (() => { const a = document.createElement('a'); return !!(a.relList && a.relList.supports && a.relList.supports('ar')); })();

/** 置く大きさ。fit＝長い辺を 60cm に（机の上） */
const SCALES = [
  { v: '1', label: '原寸', of: () => 1 },
  { v: 'fit', label: '机の上', of: (sz) => 0.6 / Math.max(sz.x, sz.y, sz.z, 1e-6) },
  { v: '0.1', label: '1/10', of: () => 0.1 },
  { v: '0.02', label: '1/50', of: () => 0.02 },
  { v: '0.01', label: '1/100', of: () => 0.01 },
];
const scaleOf = (v) => SCALES.find((x) => x.v === v) || SCALES[0];

const S = {
  model: null,        // { group, box, stats, name, kind, headerUnit, mtl, notes }
  id: 0,              // 読むたびに増える（USDZ の作り直しの目印）
  unit: 'mm', unitWhy: '',
  zUp: false,
  scale: '1',
  size: new THREE.Vector3(),
  usdz: null,         // { key, url, file, bytes }
  usdzJob: null,
  xrOK: false,
  xr: null,           // AR 中の状態
};

/* ───────── 3D の場 ───────── */
const canvas = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.xr.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
let dirty = true;
controls.addEventListener('change', () => { dirty = true; });

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(3, 6, 4);
scene.add(sun);

const holder = new THREE.Group();   // AR で置く位置・向き
const scaler = new THREE.Group();   // 置く大きさ（AR の中だけ。見本は原寸）
const fit = new THREE.Group();      // 単位・上下・底の中心を原点に
fit.matrixAutoUpdate = false;
holder.add(scaler); scaler.add(fit); scene.add(holder);

/** 足もとの影（丸いぼかし）。AR で床に置いた感じを出す。USDZ には入れない（Quick Look は自分で影を付ける） */
const shadow = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.6 }));
  m.position.y = 0.002; m.renderOrder = -1;
  m.visible = false;      // 見本の画面では出さない（離れて並んだ機器だと、何も無い所まで暗くなる）。AR の中だけ
  return m;
})();
scaler.add(shadow);

/** 置く場所の輪（Android の AR） */
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff }));
reticle.matrixAutoUpdate = false; reticle.visible = false;
scene.add(reticle);

let grid = null;

function resize() {
  if (renderer.xr.isPresenting) return;
  const r = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(resize).observe(canvas.parentElement);

renderer.setAnimationLoop((t, frame) => {
  if (frame && S.xr) { xrFrame(frame); renderer.render(scene, camera); return; }
  if (dirty) { dirty = false; renderer.render(scene, camera); }
});

/* ───────── 知らせ ───────── */
function msg(text, kind = '') {
  const el = $('#msg');
  if (!text) { el.className = 'msg hide'; el.textContent = ''; return; }
  el.className = 'msg ' + kind; el.textContent = text;
}
const fmtN = (v) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const fmtSize = (s) => `幅 ${fmtN(s.x)} × 奥行 ${fmtN(s.z)} × 高さ ${fmtN(s.y)} m`;
const nf = (n) => Number(n).toLocaleString('ja-JP');
/** 知らせを画面に描かせてから重い処理へ進む。★画面が隠れている（ほかのアプリに切り替えた）と
 *  requestAnimationFrame は来ないので、時間でも抜ける */
const tick = () => new Promise((r) => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 120);
});

/* ───────── ① 読む ───────── */
$('#file').addEventListener('change', async (e) => {
  const list = [...e.target.files];
  e.target.value = '';           // 同じファイルをもう一度選べるように
  if (!list.length) return;
  msg(`読み込んでいます…（${list.map((f) => f.name).join('・')}）`, 'busy');
  await tick();
  try {
    const picked = [];
    for (const f of list) picked.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    await loadPicked(picked);
  } catch (err) {
    console.error(err);
    msg('読めませんでした：' + (err && err.message ? err.message : err), 'ng');
  }
});

/** 読んだバイト列から形を作って画面に出す（検査からも呼ぶ） */
async function loadPicked(picked) {
  msg('読み込んでいます…', 'busy');
  await tick();
  const r = await readFiles(picked);
  msg('形をまとめています…（大きいファイルは数十秒かかります）', 'busy');
  await tick();
  const m = mergeByMaterial(r.root, { noMtl: r.kind === 'obj' && r.mtl === 'none' });
  if (!m.group.children.length) throw new Error('形（面）が1つもありませんでした。');
  //  前の形を片づける
  if (S.model) disposeGroup(S.model.group);
  S.model = Object.assign(m, { name: r.name, kind: r.kind, headerUnit: r.headerUnit, mtl: r.mtl, notes: r.notes });
  S.id++;
  const maxRaw = Math.max(...m.box.getSize(new THREE.Vector3()).toArray());
  if (r.headerUnit) { S.unit = r.headerUnit; S.unitWhy = 'ファイルの書き込みから'; }
  else { S.unit = unitFromSize(maxRaw); S.unitWhy = '大きさから推定・違えば押して直す'; }
  S.zUp = false;
  applyModel(true);
  //  はじめの大きさ：8m に収まれば原寸、大きければ机の上
  S.scale = Math.max(S.size.x, S.size.z) <= 8 ? '1' : 'fit';
  paintScale();
  ['#s-view', '#s-scale', '#s-ar'].forEach((s) => $(s).classList.remove('hide'));
  msg('');
  resize();
  frameCamera();
  prepareAR();
  return S.model;
}

function disposeGroup(g) {
  g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
}

/** 単位・上下を変えたら、外形・カメラ・影・格子・USDZ を作り直す */
function applyModel(first) {
  const m = S.model;
  fit.clear();
  fit.add(m.group);
  const f = fitMatrix(m.box, S.unit === 'mm' ? 0.001 : 1, S.zUp);
  fit.matrix.copy(f.matrix);
  fit.matrixWorldNeedsUpdate = true;
  S.size.copy(f.size);
  shadow.scale.set(Math.max(f.size.x, 0.01) * 1.25, 1, Math.max(f.size.z, 0.01) * 1.25);
  paintGrid();
  paintFacts();
  paintUnit();
  if (!first) { paintScale(); frameCamera(); prepareAR(); }
  dirty = true;
}

function paintGrid() {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  const span = Math.max(S.size.x, S.size.z) * 1.4;
  const step = span <= 6 ? 0.5 : span <= 30 ? 1 : span <= 150 ? 5 : 10;
  const size = Math.max(step * 2, Math.ceil(span / step) * step);
  grid = new THREE.GridHelper(size, Math.round(size / step), 0x7d889a, 0xb9c2cf);
  grid.material.transparent = true; grid.material.opacity = 0.7;
  scene.add(grid);
}

function frameCamera() {
  const s = S.size;
  const r = Math.max(s.length() / 2, 0.05);
  //  縦の画角と横の画角の狭いほうで、外接球が収まる距離（少し寄せる＝球は細長い物に対して大きすぎる）
  const vf = THREE.MathUtils.degToRad(camera.fov);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const dist = r / Math.sin(Math.min(vf, hf) / 2) * 0.82;
  const dir = new THREE.Vector3(0.9, 0.62, 1.15).normalize();
  controls.target.set(0, s.y / 2, 0);
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  camera.near = Math.max(dist / 500, 0.005); camera.far = dist * 40;
  camera.updateProjectionMatrix();
  controls.update();
  dirty = true;
}
$('#b-home').addEventListener('click', frameCamera);

function paintFacts() {
  const m = S.model;
  const rows = [
    ['ファイル', m.name],
    ['大きさ', fmtSize(S.size)],
    ['部品', `${nf(m.stats.parts)} 個 → 色ごとに ${nf(m.stats.meshes)} 個にまとめました`],
    ['面（三角形）', nf(m.stats.triangles)],
    ['色', m.kind === 'glb' ? 'ファイルのまま' : m.mtl === 'ok' ? '.mtl のとおり' : '仮の色（.mtl なし）'],
  ];
  $('#facts').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const notes = m.notes.slice();
  if (m.stats.triangles > 2000000) notes.push('とても重い形です。iPhone の AR で開けない・時間がかかることがあります。Matelier で見せたい範囲だけを書き出すと軽くなります。');
  $('#notes').innerHTML = [...new Set(notes)].slice(0, 6).map((n) => `<li>${esc(n)}</li>`).join('');
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function paintUnit() {
  $('#seg-unit').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.unit));
  $('#seg-unit').title = S.unitWhy;
}
$('#seg-unit').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !S.model || b.dataset.v === S.unit) return;
  S.unit = b.dataset.v; S.unitWhy = '手で選んだ';
  applyModel(false);
});
$('#b-up').addEventListener('click', () => { if (!S.model) return; S.zUp = !S.zUp; applyModel(false); });

/* ───────── ③ 大きさ ───────── */
$('#seg-scale').innerHTML = SCALES.map((x) => `<button type="button" data-v="${x.v}">${x.label}</button>`).join('');
$('#seg-scale').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.dataset.v === S.scale) return;
  S.scale = b.dataset.v; paintScale(); prepareAR();
});
const arScale = () => scaleOf(S.scale).of(S.size);
function paintScale() {
  $('#seg-scale').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.scale));
  if (!S.model) return;
  const k = arScale();
  const placed = S.size.clone().multiplyScalar(k);
  const ratio = S.scale === 'fit' ? `（約 1/${nf(Math.round(1 / k))}）` : S.scale === '1' ? '' : `（${scaleOf(S.scale).label}）`;
  let t = `置いたときの大きさ：${fmtSize(placed)}${ratio}`;
  if (S.scale === '1' && Math.max(S.size.x, S.size.z) > 8) t += '。原寸だと大きいので、広い場所で置いて歩きながら見てください（机の上で見るなら「机の上」）。';
  if (S.scale === '1' && QUICKLOOK) t += ' 原寸のときは、指で広げる・縮めるができないようにしています。';
  $('#scale-note').textContent = t;
  if (S.xr) $('#xr-scale').textContent = scaleOf(S.scale).label;
}

/* ───────── ④ AR ───────── */
const arBtn = $('#b-ar');
function arMode() { return QUICKLOOK ? 'ql' : S.xrOK ? 'xr' : ''; }

function paintAR(state) {
  const mode = arMode();
  const note = $('#ar-note');
  if (mode === 'ql') {
    arBtn.disabled = state !== 'ready';
    arBtn.textContent = state === 'ready' ? '📱 ARで見る' : state === 'fail' ? 'AR の準備に失敗しました' : '⏳ AR の準備中…';
    note.innerHTML = '床にカメラを向けると置かれます。指1本で動かす・2本で回す。右上の × で戻ります。' +
      (S.usdz ? `<br>（USDZ ${(S.usdz.bytes / 1048576).toFixed(1)} MB）` : '');
  } else if (mode === 'xr') {
    arBtn.disabled = false;
    arBtn.textContent = '📱 ARで見る';
    note.textContent = '床を映して、白い輪が出たら画面をタップして置きます。もう一度タップで置き直し。下のボタンで回す・大きさを変える。';
  } else {
    arBtn.disabled = true;
    arBtn.textContent = 'この画面では AR が使えません';
    note.textContent = IS_IOS
      ? 'Teams・SharePoint・OneDrive などのアプリの中の画面では AR が開きません。右上の［…］や共有ボタンから「Safari で開く」を選んでください。'
      : /Android/i.test(navigator.userAgent)
        ? 'Chrome で開いてください。AR には「Google Play 開発者サービス（AR）」が入った端末が要ります。'
        : 'パソコンでは AR は使えません。形の確認と、iPhone 用の USDZ の保存はできます。';
  }
}

/** iPhone は USDZ を先に作っておく（押してから作ると、Safari が「押した直後」とみなさないことがあるため） */
let prepTimer = 0;
function prepareAR() {
  paintAR('wait');
  if (arMode() !== 'ql') { paintAR(''); return; }
  clearTimeout(prepTimer);
  prepTimer = setTimeout(() => {
    makeUSDZ().then(() => paintAR('ready')).catch((err) => { console.error(err); paintAR('fail'); msg('USDZ を作れませんでした：' + (err.message || err), 'ng'); });
  }, 250);
}

/** いまの形・単位・上下・大きさで USDZ を作る（同じ条件なら作り直さない） */
async function makeUSDZ() {
  const key = [S.id, S.unit, S.zUp, S.scale].join('|');
  if (S.usdz && S.usdz.key === key) return S.usdz;
  if (S.usdzJob && S.usdzJob.key === key) return S.usdzJob.p;
  const p = (async () => {
    await tick();
    const ex = new THREE.Group();
    ex.add(fit.clone());                       // 形（geometry）は写さず共有。影は入れない
    ex.scale.setScalar(arScale());
    ex.updateMatrixWorld(true);
    //  USDZ は片面だけ（面の向きは model.js が法線にそろえてある）。両面のままだと書き出しが色ごとに警告を出すので、
    //  書き出しのあいだだけ表の面に（見本の画面は両面のまま）
    const mats = new Set();
    ex.traverse((o) => { if (o.isMesh) mats.add(o.material); });
    const sides = [...mats].map((m) => [m, m.side]);
    sides.forEach(([m]) => { m.side = THREE.FrontSide; });
    let data;
    try {
      data = await new USDZExporter().parseAsync(ex, {
        quickLookCompatible: true,
        ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
      });
    } finally { sides.forEach(([m, s]) => { m.side = s; }); }
    if (S.usdz) URL.revokeObjectURL(S.usdz.url);
    const base = String(S.model.name).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'model';
    S.usdz = { key, url: URL.createObjectURL(new Blob([data], { type: 'model/vnd.usdz+zip' })), file: `${base}_${scaleOf(S.scale).label.replace('/', '-')}.usdz`, bytes: data.byteLength };
    return S.usdz;
  })();
  S.usdzJob = { key, p };
  try { return await p; } finally { if (S.usdzJob && S.usdzJob.p === p) S.usdzJob = null; }
}

/** AR Quick Look を開く（model-viewer と同じ形：rel="ar" の a に img を1つ入れて押す） */
function openQuickLook() {
  if (!S.usdz) return;
  const a = document.createElement('a');
  a.setAttribute('rel', 'ar');
  a.appendChild(document.createElement('img'));
  a.setAttribute('href', S.usdz.url + (S.scale === '1' ? '#allowsContentScaling=0' : ''));
  a.setAttribute('download', S.usdz.file);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 2000);
}

arBtn.addEventListener('click', () => {
  if (arMode() === 'ql') openQuickLook();
  else if (arMode() === 'xr') startXR();
});

$('#b-usdz').addEventListener('click', async () => {
  if (!S.model) return;
  const b = $('#b-usdz'); b.disabled = true;
  try {
    msg('USDZ を作っています…', 'busy');
    const u = await makeUSDZ();
    const a = document.createElement('a');
    a.href = u.url; a.download = u.file; a.style.display = 'none';
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 2000);
    msg(`${u.file}（${(u.bytes / 1048576).toFixed(1)} MB）を保存しました。`, 'ok');
  } catch (err) {
    console.error(err); msg('USDZ を作れませんでした：' + (err.message || err), 'ng');
  } finally { b.disabled = false; }
});

/* ───────── Android：WebXR ───────── */
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-ar').then((ok) => { S.xrOK = !!ok; if (S.model) paintAR(''); }).catch(() => {});
}
const xrUI = $('#xr-ui');
//  ★操作のボタンを押したときに、AR の「タップ（select）」が起きて置き直されないように
$('#xr-bar').addEventListener('beforexrselect', (e) => e.preventDefault());

async function startXR() {
  xrUI.classList.remove('hide');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: xrUI },
    });
  } catch (err) {
    xrUI.classList.add('hide');
    msg('AR を始められませんでした：' + (err.message || err), 'ng');
    return;
  }
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  S.xr = { session, hit: null, placed: false, rot: 0 };
  const viewer = await session.requestReferenceSpace('viewer');
  S.xr.hit = await session.requestHitTestSource({ space: viewer });
  if (grid) grid.visible = false;
  shadow.visible = true;
  holder.visible = false;
  scaler.scale.setScalar(arScale());
  $('#xr-scale').textContent = scaleOf(S.scale).label;
  $('#xr-hint').textContent = '床にカメラを向けて、ゆっくり動かしてください';
  session.addEventListener('select', () => {
    if (!reticle.visible) return;
    holder.position.setFromMatrixPosition(reticle.matrix);
    //  はじめに置くときは、こちら（カメラ）に正面を向ける
    if (!S.xr.placed) {
      const cam = renderer.xr.getCamera();
      const p = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      S.xr.rot = Math.atan2(p.x - holder.position.x, p.z - holder.position.z);
    }
    holder.rotation.set(0, S.xr.rot, 0);
    holder.visible = true;
    S.xr.placed = true;
    $('#xr-hint').textContent = 'タップで置き直し・下のボタンで回す';
  });
  session.addEventListener('end', endXR);
}

function xrFrame(frame) {
  const x = S.xr;
  if (!x || !x.hit) return;
  const ref = renderer.xr.getReferenceSpace();
  const hits = frame.getHitTestResults(x.hit);
  if (hits.length) {
    const pose = hits[0].getPose(ref);
    reticle.visible = true;
    reticle.matrix.fromArray(pose.transform.matrix);
    if (!x.placed) $('#xr-hint').textContent = '白い輪のところをタップすると置きます';
  } else reticle.visible = false;
}

function endXR() {
  if (S.xr && S.xr.hit) S.xr.hit.cancel();
  S.xr = null;
  xrUI.classList.add('hide');
  reticle.visible = false;
  holder.visible = true;
  holder.position.set(0, 0, 0); holder.rotation.set(0, 0, 0);
  scaler.scale.setScalar(1);
  shadow.visible = false;
  if (grid) grid.visible = true;
  resize();
  frameCamera();
}

$('#xr-bar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !S.xr) return;
  const k = b.dataset.x;
  if (k === 'rotl' || k === 'rotr') { S.xr.rot += (k === 'rotl' ? 1 : -1) * Math.PI / 12; holder.rotation.set(0, S.xr.rot, 0); }
  else if (k === 'scale') {
    const i = SCALES.findIndex((x) => x.v === S.scale);
    S.scale = SCALES[(i + 1) % SCALES.length].v;
    scaler.scale.setScalar(arScale());
    paintScale();
  } else if (k === 'end') S.xr.session.end();
});

/* ───────── オフライン（https のときだけ） ───────── */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

paintAR('');

//  検査の窓口（画面の確かめ用。外へは何も出さない）
window.__AR = { S, loadPicked, makeUSDZ, scene, fit, arScale, QUICKLOOK, arMode, SCALES };
