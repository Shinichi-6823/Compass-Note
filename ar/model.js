/* model.js ― 選んだファイル（zip・obj＋mtl・glb）を読んで、AR で軽く出せる形にまとめる
 *
 *   ★ Matelier 3D の「OBJ書き出し」は Matelier3D_<日付>.zip（中に matelier3d.obj と matelier3d.mtl）。
 *     単位は mm（等倍）か m（1/1000）を選べる。OBJ の頭の「# 単位: …」で見分ける。
 *     自動倉庫の書き出し（exporters3d.js）は .obj と .mtl が別々に落ちる（頭に「単位:mm」）。
 *   ★ OBJ は部品ごとに「g 名前」が並ぶので、そのまま読むと部品の数だけ形ができる（数千〜数万）。
 *     iPhone の AR（Quick Look）も Android の WebXR も、形の数が多いと極端に重くなるので、
 *     **色（マテリアル）ごとに1つの形へまとめる**。見た目は変わらない。
 *   ★ 外へは何も送らない。テクスチャの参照先が見つからないときも、ネットへ取りに行かず白で埋める。
 */
import * as THREE from 'three';
import { OBJLoader } from './vendor/addons/loaders/OBJLoader.js';
import { MTLLoader } from './vendor/addons/loaders/MTLLoader.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from './vendor/addons/utils/BufferGeometryUtils.js';
import { unzipSync } from './vendor/addons/libs/fflate.module.js';

const extOf = (n) => ((String(n).match(/\.([^./\\]+)$/) || [])[1] || '').toLowerCase();
const baseOf = (n) => String(n).split(/[\\/]/).pop();
const td = new TextDecoder('utf-8');
const text = (u8) => td.decode(u8);
/** 1×1 の白（見つからないテクスチャの代わり。ネットへ取りに行かせない） */
const WHITE_PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

/** zip を開いて、中身を平らに並べる（フォルダの階層は捨てて名前だけにする） */
export function flatten(list) {
  const out = [];
  for (const f of list) {
    if (extOf(f.name) === 'zip') {
      let z;
      try { z = unzipSync(f.data); } catch (e) { throw new Error(`zip を開けませんでした（${f.name}）: ${e.message || e}`); }
      for (const [n, d] of Object.entries(z)) {
        if (n.endsWith('/') || /(^|\/)__MACOSX\//.test(n) || baseOf(n).startsWith('._')) continue;
        out.push({ name: baseOf(n), data: d, from: f.name });
      }
    } else out.push(f);
  }
  return out;
}

/** OBJ の頭の書き込みから単位を読む（Matelier・自動倉庫の書き出し）。分からなければ null */
export function unitFromHeader(objText) {
  const head = objText.slice(0, 600);
  if (/1000\s*分の\s*1|単位\s*[:：]\s*m(?![m\w])/.test(head)) return 'm';
  if (/単位\s*[:：]?\s*mm/.test(head)) return 'mm';
  return null;
}

/** 大きさから単位を当てる。長い辺が 250 以上なら mm（250m の物はまず無い・250mm 未満の物は AR で見ない） */
export function unitFromSize(maxDim) { return maxDim >= 250 ? 'mm' : 'm'; }

/**
 * 選んだファイルを読む。
 * @param {{name:string,data:Uint8Array}[]} picked
 * @returns {Promise<{root:THREE.Object3D, name:string, kind:'obj'|'glb', headerUnit:string|null, mtl:'ok'|'none'|'given', notes:string[]}>}
 */
export async function readFiles(picked) {
  const all = flatten(picked);
  const objs = all.filter((f) => extOf(f.name) === 'obj');
  const glbs = all.filter((f) => extOf(f.name) === 'glb' || extOf(f.name) === 'gltf');
  const mtls = all.filter((f) => extOf(f.name) === 'mtl');
  const notes = [];
  const shown = picked.map((f) => f.name).join('・');
  if (!objs.length && !glbs.length) {
    if (mtls.length) throw new Error('.mtl（色の情報）だけでは形がありません。.obj も一緒に選んでください（Matelier の zip ならそのまま選べます）。');
    throw new Error(`3D の形（.obj・.glb）が見つかりません。選んだもの: ${shown}`);
  }
  //  テクスチャ・.bin は名前で引けるようにしておく
  const urls = new Map();
  for (const f of all) {
    const e = extOf(f.name);
    if (['obj', 'mtl', 'glb', 'zip'].includes(e)) continue;
    urls.set(baseOf(f.name).toLowerCase(), URL.createObjectURL(new Blob([f.data])));
  }
  const manager = new THREE.LoadingManager();
  let pending = 0;
  manager.setURLModifier((u) => {
    if (/^(data|blob):/.test(u)) return u;
    const k = decodeURIComponent(baseOf(u.split(/[?#]/)[0])).toLowerCase();
    if (urls.has(k)) { pending++; return urls.get(k); }
    notes.push(`見つからない参照: ${baseOf(u)}（白で出します）`);
    return WHITE_PX;
  });
  const waitTextures = () => (pending ? new Promise((res) => { manager.onLoad = res; setTimeout(res, 4000); }) : Promise.resolve());

  if (objs.length) {
    if (objs.length > 1) notes.push(`OBJ が ${objs.length} 個あったので、まとめて出します。`);
    const root = new THREE.Group();
    let headerUnit = null;
    let mtl = 'none';
    for (const o of objs) {
      const src = text(o.data);
      headerUnit = headerUnit || unitFromHeader(src);
      //  mtllib の名前と同じ .mtl を探す。無ければ1つしかない .mtl を使う（zip の日本語名が化けても当たるように）
      const want = (src.slice(0, 4000).match(/^mtllib\s+(.+)$/m) || [])[1];
      let m = want && mtls.find((x) => baseOf(x.name).toLowerCase() === baseOf(want.trim()).toLowerCase());
      if (!m && mtls.length === 1) m = mtls[0];
      if (!m && mtls.length > 1) m = mtls.find((x) => baseOf(x.name).replace(/\.mtl$/i, '') === baseOf(o.name).replace(/\.obj$/i, ''));
      const loader = new OBJLoader(manager);
      if (m) {
        const ml = new MTLLoader(manager);
        const mc = ml.parse(text(m.data), '');
        mc.preload();
        loader.setMaterials(mc);
        mtl = mtl === 'none' ? 'ok' : mtl;
      } else if (want) {
        notes.push(`色の情報（${baseOf(want.trim())}）が選ばれていないので、色は仮の色で出します。zip か .mtl も一緒に選んでください。`);
      }
      root.add(loader.parse(src));
    }
    await waitTextures();
    const name = objs.length === 1 ? (objs[0].from || objs[0].name) : (picked[0] && picked[0].name) || 'model';
    return { root, name, kind: 'obj', headerUnit, mtl, notes };
  }

  const g = glbs[0];
  if (glbs.length > 1) notes.push(`GLB が ${glbs.length} 個あったので、最初の ${g.name} を出します。`);
  const buf = g.data.buffer.slice(g.data.byteOffset, g.data.byteOffset + g.data.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader(manager).parse(extOf(g.name) === 'gltf' ? text(g.data) : buf, '', res, rej));
  await waitTextures();
  return { root: gltf.scene, name: g.from || g.name, kind: 'glb', headerUnit: null, mtl: 'given', notes };
}

/* ───────── 色（マテリアル） ───────── */

/** 名前から決まる、落ち着いた仮の色（.mtl が無いとき。同じ名前は同じ色） */
function nameColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.28, 0.62);
}

/** どんなマテリアルでも、USDZ に書ける MeshStandardMaterial にする（USDZExporter はこれしか書かない） */
function toStandard(m, fallbackGray) {
  if (!m) return new THREE.MeshStandardMaterial({ color: 0xb8bec8, roughness: 0.8, side: THREE.DoubleSide });
  const metal = /metal|steel|chrome|sus|ﾒｯｷ|メッキ/i.test(m.name || '') || (m.shininess || 0) >= 100;
  const opacity = typeof m.opacity === 'number' ? m.opacity : 1;
  const s = new THREE.MeshStandardMaterial({
    name: m.name || '',
    color: fallbackGray ? nameColor(m.name) : (m.color ? m.color.clone() : new THREE.Color(0xb8bec8)),
    map: m.map || null,
    roughness: m.isMeshStandardMaterial ? m.roughness : (metal ? 0.45 : 0.8),
    metalness: m.isMeshStandardMaterial ? Math.min(m.metalness, 0.6) : (metal ? 0.3 : 0),
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    vertexColors: !!m.vertexColors,
    side: THREE.DoubleSide,               // 書き出し元によって面の向きがそろっていないことがある
  });
  return s;
}

/* ───────── 形をまとめる ───────── */

/** 属性を素の Float32 にそろえる（GLB の interleaved・normalized 対策） */
function plainAttr(a) {
  if (!a.isInterleavedBufferAttribute && !a.normalized && a.array instanceof Float32Array) return a;
  const n = a.count, s = a.itemSize, arr = new Float32Array(n * s);
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[i * s + k] = get[k].call(a, i);
  return new THREE.BufferAttribute(arr, s);
}

/** 頂点の範囲 [start, start+count) だけを切り出す（索引なしの形） */
function sliceGeo(g, start, count) {
  const out = new THREE.BufferGeometry();
  for (const [k, a0] of Object.entries(g.attributes)) {
    const a = plainAttr(a0);
    out.setAttribute(k, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return out;
}

/** まとめる前に、属性を position・normal（・uv）だけにする。
 *  ★配列は必ず写す（同じ形を複数の部品が使っている GLB で、位置を2回焼き込まないように） */
function tidy(g, wantUV) {
  const out = new THREE.BufferGeometry();
  const own = (a) => { const p = plainAttr(a); return new THREE.BufferAttribute(p === a ? a.array.slice() : p.array, p.itemSize); };
  out.setAttribute('position', own(g.attributes.position));
  if (g.attributes.normal) out.setAttribute('normal', own(g.attributes.normal));
  else out.computeVertexNormals();
  if (wantUV) {
    out.setAttribute('uv', g.attributes.uv ? own(g.attributes.uv) : new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  }
  return out;
}

/** 三角形 t の2点目と3点目を入れ替える（索引なしの形） */
function swapTri(g, t) {
  for (const a of Object.values(g.attributes)) {
    const s = a.itemSize, arr = a.array;
    for (let k = 0; k < s; k++) {
      const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k;
      const v = arr[i1]; arr[i1] = arr[i2]; arr[i2] = v;
    }
  }
}

/** 鏡に映した部品（行列の行列式が負）は面の向きが裏返るので、三角形の2点目と3点目を入れ替えて戻す */
function flipWinding(g) {
  for (let t = 0; t + 2 < g.attributes.position.count; t += 3) swapTri(g, t);
}

/**
 * ファイルに法線（vn）があるとき、面の向き（点の回り方）を法線にそろえる。
 * ★iPhone の AR（USDZ）は片面しか描かない（three.js r169 の USDZExporter は両面を書けない）。
 *   書き出し元によって点の回り方が逆の面があると、iPhone でだけ穴があいて見えるため。
 *   Matelier の OBJ は 12万面で裏返り 0（2026-11-09 に数えた）。ほかの CAD の OBJ のための備え。
 * @returns {number} 直した三角形の数
 */
function orientToNormals(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  let fixed = 0;
  for (let t = 0; t + 2 < g.attributes.position.count; t += 3) {
    const a = t * 3, b = a + 3, c = a + 6;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const d = fx * (n[a] + n[b] + n[c]) + fy * (n[a + 1] + n[b + 1] + n[c + 1]) + fz * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (d < 0) { swapTri(g, t); fixed++; }
  }
  return fixed;
}

/**
 * 読んだ形を、色ごとに1つずつの Mesh にまとめる（座標はファイルの単位のまま・ワールドの位置は焼き込む）。
 * @returns {{group:THREE.Group, box:THREE.Box3, stats:{parts:number, meshes:number, triangles:number, vertices:number}}}
 */
export function mergeByMaterial(root, opts = {}) {
  root.updateMatrixWorld(true);
  const buckets = new Map();   // マテリアル → 形の並び
  let parts = 0, flipped = 0;
  const fallbackGray = !!opts.noMtl;
  const stdOf = new Map();
  const std = (m) => { if (!stdOf.has(m)) stdOf.set(m, toStandard(m, fallbackGray)); return stdOf.get(m); };
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (o.isSkinnedMesh) return;   // 動く人形などは対象外
    parts++;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = Array.isArray(o.material) && g.groups.length
      ? g.groups
      : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = std(mats[gr.materialIndex] || mats[0]);
      const whole = gr.start === 0 && gr.count >= g.attributes.position.count;
      const sub = whole ? tidy(g, !!mat.map) : tidy(sliceGeo(g, gr.start, gr.count), !!mat.map);
      sub.applyMatrix4(o.matrixWorld);
      if (g.attributes.normal) flipped += orientToNormals(sub);       // 法線がファイルにある＝それが正
      else if (o.matrixWorld.determinant() < 0) flipWinding(sub);     // 法線を作った＝回り方が正。鏡だけ戻す
      if (!buckets.has(mat)) buckets.set(mat, []);
      buckets.get(mat).push(sub);
    }
  });
  const group = new THREE.Group();
  let triangles = 0, vertices = 0;
  for (const [mat, geos] of buckets) {
    let merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    triangles += merged.attributes.position.count / 3;
    //  同じ位置・同じ法線の頂点をまとめる（箱なら 6→4。USDZ が 3 割ほど軽くなる）。
    //  ★法線は消さずに一緒に比べる。位置だけでまとめて法線を作り直すと角が丸まり、
    //    iPhone の AR（Quick Look）では機械がぼやけた陰影になる（flatShading は USDZ に書けない）
    merged = mergeVertices(merged, 1e-4);
    vertices += merged.attributes.position.count;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat.name || 'part';
    group.add(mesh);
  }
  const box = new THREE.Box3().setFromObject(group);
  return { group, box, stats: { parts, meshes: group.children.length, triangles: Math.round(triangles), vertices, flipped } };
}

/**
 * ファイルの単位・上下の向きから、「m 単位・底の中心が原点」へ合わせる行列を作る。
 * @param {THREE.Box3} rawBox ファイルの単位のままの外形
 * @param {number} unitScale mm なら 0.001
 * @param {boolean} zUp Z が上のファイル（Y を上に起こす）
 */
export function fitMatrix(rawBox, unitScale, zUp) {
  const RS = new THREE.Matrix4().makeScale(unitScale, unitScale, unitScale);
  if (zUp) RS.premultiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const b = rawBox.clone().applyMatrix4(RS);
  const c = b.getCenter(new THREE.Vector3());
  const T = new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z);
  const size = b.getSize(new THREE.Vector3());
  return { matrix: T.multiply(RS), size };
}
