// BlockForge editor. The server owns the model; every edit is a command POSTed to
// /api/command and the new model comes back over SSE (/api/events).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { MeshRef } from './mesh.js';
import { exportRbxmx } from './roblox.js';

const MATERIAL_LIST = ['smooth', 'plastic', 'neon', 'metal', 'glass', 'wood', 'woodplanks', 'slate', 'concrete', 'brick', 'granite',
  'marble', 'cobblestone', 'fabric', 'grass', 'sand', 'ice', 'foil', 'diamondplate', 'corrodedmetal', 'forcefield'];

const $ = (s) => document.querySelector(s);
const DEG = Math.PI / 180;
const r3 = (n) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// State + API
// ---------------------------------------------------------------------------
const S = {
  model: { name: '', parts: [] },
  project: null,
  refs: [],
  selected: null,
  collapsed: new Set(),
  job: null,
  hasOpenAI: false,
  hasLLM: false,
  config: {},
};

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}
async function cmd(c) {
  try { return await api('/api/command', c); }
  catch (e) { addLog({ kind: 'error', text: e.message, time: Date.now() }); }
}
const partById = (id) => S.model.parts.find((p) => p.id === id);
const childrenOf = (id) => S.model.parts.filter((p) => p.parent === id);
function pivotOf(groupId) {
  const g = groupId && partById(groupId);
  return g ? g.pivot : [0, 0, 0];
}

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const viewportEl = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewportEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2d33');
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
camera.position.set(9, 7, 12);

scene.add(new THREE.HemisphereLight('#ffffff', '#555566', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.8);
sun.position.set(5, 10, 7);
scene.add(sun);
const fill = new THREE.DirectionalLight('#ffffff', 0.5);
fill.position.set(-6, 3, -5);
scene.add(fill);

const grid = new THREE.GridHelper(40, 40, '#4a505c', '#353a43');
scene.add(grid);
const axes = new THREE.AxesHelper(1.5);
axes.position.y = 0.002;
scene.add(axes);

const modelRoot = new THREE.Group();
scene.add(modelRoot);
const meshRef = new MeshRef(scene); // 3D scan reference (ghost)

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 2, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.15;

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setTranslationSnap(0.1);
gizmo.setRotationSnap(15 * DEG);
gizmo.setScaleSnap(0.1);
const gizmoHelper = gizmo.getHelper();
scene.add(gizmoHelper);
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (!e.value) commitGizmo();
});

const selBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#3e90ff'));
selBox.visible = false;
scene.add(selBox);

// Shared geometries (unit size; mesh.scale = part size)
function wedgeGeometry() {
  const A = [-0.5, -0.5, -0.5], B = [0.5, -0.5, -0.5], C = [0.5, -0.5, 0.5], D = [-0.5, -0.5, 0.5];
  const E = [-0.5, 0.5, -0.5], F = [0.5, 0.5, -0.5];
  const tris = [A, B, C, A, C, D, A, E, F, A, F, B, E, D, C, E, C, F, A, D, E, B, F, C];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 28),
  sphere: new THREE.SphereGeometry(0.5, 28, 18),
  wedge: wedgeGeometry(),
};
const EDGES = Object.fromEntries(Object.entries(GEO).map(([k, g]) => [k, new THREE.EdgesGeometry(g, 35)]));
const edgeMat = new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28 });
const selEdgeMat = new THREE.LineBasicMaterial({ color: '#4da3ff', depthTest: false, transparent: true });

const matCache = new Map();
function materialFor(color, kind) {
  const key = color + kind;
  if (matCache.has(key)) return matCache.get(key);
  const base = { color: new THREE.Color(color) };
  let m;
  const std = (o) => new THREE.MeshStandardMaterial({ ...base, metalness: 0, ...o });
  switch (kind) {
    case 'smooth': m = std({ roughness: 0.3 }); break;
    case 'metal': m = std({ roughness: 0.3, metalness: 0.85 }); break;
    case 'foil': m = std({ roughness: 0.12, metalness: 0.95 }); break;
    case 'diamondplate': m = std({ roughness: 0.35, metalness: 0.8 }); break;
    case 'corrodedmetal': m = std({ roughness: 0.85, metalness: 0.45 }); break;
    case 'neon': m = std({ emissive: new THREE.Color(color), emissiveIntensity: 1.2, roughness: 0.4 }); break;
    case 'glass': m = std({ roughness: 0.05, transparent: true, opacity: 0.45 }); break;
    case 'ice': m = std({ roughness: 0.08, transparent: true, opacity: 0.8 }); break;
    case 'forcefield': m = std({ emissive: new THREE.Color(color), emissiveIntensity: 0.6, transparent: true, opacity: 0.35 }); break;
    case 'marble': m = std({ roughness: 0.25 }); break;
    case 'wood': case 'woodplanks': case 'slate': case 'concrete': case 'brick': case 'granite':
    case 'cobblestone': case 'fabric': case 'grass': case 'sand': m = std({ roughness: 0.95 }); break;
    default: m = std({ roughness: 0.62 }); // plastic
  }
  matCache.set(key, m);
  return m;
}

// Classic Roblox studs (top) and inlets (bottom), tiled 1 per stud.
function surfaceTexture(kind) {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#f0f0f0'; g.fillRect(0, 0, S, S);
  const r = S * 0.3, cx = S / 2, cy = S / 2;
  if (kind === 'studs') {
    g.fillStyle = '#9a9a9a'; g.beginPath(); g.arc(cx + 5, cy + 6, r, 0, Math.PI * 2); g.fill(); // drop shadow
    const grad = g.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.1, cx, cy, r);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#dcdcdc');
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  } else {
    g.fillStyle = '#c4c4c4'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a8a8a8'; g.beginPath(); g.arc(cx - 3, cy - 3, r * 0.85, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const SURF_TEX = { studs: surfaceTexture('studs'), inlet: surfaceTexture('inlet') };
const surfCache = new Map();
function studMaterials(color, kind, size, allFaces = false) {
  const side = materialFor(color, kind);
  // u,v extents of a face in studs → texture repeats (one stud per tile)
  const mk = (which, u = size[0], v = size[2]) => {
    const key = `${which}|${color}|${kind}|${u}x${v}`;
    if (!surfCache.has(key)) {
      const tex = SURF_TEX[which].clone();
      tex.repeat.set(Math.max(1, Math.round(u)), Math.max(1, Math.round(v)));
      tex.needsUpdate = true;
      const m = side.clone();
      m.map = tex;
      surfCache.set(key, m);
    }
    return surfCache.get(key);
  };
  // BoxGeometry face order: +x, -x, +y (top), -y (bottom), +z, -z
  if (allFaces) {
    const sx = mk('studs', size[2], size[1]), sz = mk('studs', size[0], size[1]);
    return [sx, sx, mk('studs'), mk('inlet'), sz, sz];
  }
  return [side, side, mk('studs'), mk('inlet'), side, side];
}

// Builds a THREE object tree for a model. Group objects sit at their pivot;
// children are offset by (absolute position - parent pivot).
function buildModelObject(model, { edges = true } = {}) {
  const root = new THREE.Group();
  const objects = new Map();
  const build = (parentObj, parentId) => {
    const pp = pivotOf(parentId);
    for (const p of model.parts.filter((x) => x.parent === parentId)) {
      let obj;
      if (p.type === 'group') {
        obj = new THREE.Group();
        obj.position.set(p.pivot[0] - pp[0], p.pivot[1] - pp[1], p.pivot[2] - pp[2]);
      } else {
        const studs = String(model.style).startsWith('studs') && (p.shape || 'box') === 'box' && !['neon', 'glass', 'forcefield', 'ice'].includes(p.material);
        obj = new THREE.Mesh(GEO[p.shape] || GEO.box, studs ? studMaterials(p.color, p.material, p.size, model.style === 'studs_all') : materialFor(p.color, p.material));
        obj.position.set(p.position[0] - pp[0], p.position[1] - pp[1], p.position[2] - pp[2]);
        obj.scale.set(...p.size);
        if (edges && p.material !== 'glass') obj.add(new THREE.LineSegments(EDGES[p.shape] || EDGES.box, edgeMat));
      }
      obj.name = p.name;
      obj.rotation.set(p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG, 'XYZ');
      obj.visible = p.visible !== false;
      obj.userData.partId = p.id;
      parentObj.add(obj);
      objects.set(p.id, obj);
      if (p.type === 'group') build(obj, p.id);
    }
  };
  build(root, null);
  return { root, objects };
}

let objects = new Map();
function rebuildScene() {
  modelRoot.clear();
  const built = buildModelObject(S.model);
  for (const c of [...built.root.children]) modelRoot.add(c);
  objects = built.objects;
  applySelection();
  updateStats();
}

function applySelection() {
  // remove old highlight edges
  modelRoot.traverse((o) => { if (o.userData.selEdge) o.parent.remove(o); });
  const obj = S.selected && objects.get(S.selected);
  const part = S.selected && partById(S.selected);
  if (!obj || !part) {
    S.selected = null;
    gizmo.detach();
    selBox.visible = false;
    return;
  }
  if (part.type === 'cube') {
    const e = new THREE.LineSegments(EDGES[part.shape] || EDGES.box, selEdgeMat);
    e.userData.selEdge = true;
    e.renderOrder = 999;
    obj.add(e);
    selBox.visible = false;
  } else {
    selBox.box.setFromObject(obj);
    selBox.visible = !selBox.box.isEmpty();
  }
  if (part.type === 'group' && gizmo.getMode() === 'scale') setMode('translate');
  gizmo.attach(obj);
}

function commitGizmo() {
  const part = S.selected && partById(S.selected);
  const obj = S.selected && objects.get(S.selected);
  if (!part || !obj) return;
  const pp = pivotOf(part.parent);
  const mode = gizmo.getMode();
  if (mode === 'rotate') {
    cmd({ op: 'update_part', id: part.id, rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => r3(r / DEG)) });
  } else if (mode === 'scale' && part.type === 'cube') {
    cmd({ op: 'update_part', id: part.id, size: obj.scale.toArray().map((s) => Math.max(0.05, r3(s))) });
  } else if (mode === 'translate') {
    const abs = [obj.position.x + pp[0], obj.position.y + pp[1], obj.position.z + pp[2]].map(r3);
    if (part.type === 'group') cmd({ op: 'update_part', id: part.id, move: abs.map((v, i) => r3(v - part.pivot[i])) });
    else cmd({ op: 'update_part', id: part.id, position: abs });
  }
}

function setMode(mode) {
  const part = S.selected && partById(S.selected);
  if (mode === 'scale' && part?.type === 'group') mode = 'translate';
  gizmo.setMode(mode);
  gizmo.setSpace(mode === 'translate' ? 'world' : 'local');
  document.querySelectorAll('#modeButtons button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}

function resize() {
  const w = viewportEl.clientWidth, h = viewportEl.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewportEl);
resize();

renderer.setAnimationLoop(() => {
  orbit.update();
  if (selBox.visible && S.selected && objects.get(S.selected)) selBox.box.setFromObject(objects.get(S.selected));
  renderer.render(scene, camera);
});

// Click to select
const ray = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || gizmo.dragging) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 4 || e.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(modelRoot.children, true).find((h) => h.object.isMesh && h.object.visible);
  if (gizmo.axis) return; // clicked the gizmo
  let id = hit?.object.userData.partId || null;
  // Clicking an already-selected cube selects its group
  if (id && id === S.selected && e.altKey) id = partById(id)?.parent || id;
  select(id);
});

// ---------------------------------------------------------------------------
// Camera presets + offscreen renders (used by Claude / MCP)
// ---------------------------------------------------------------------------
const VIEW_DIRS = {
  front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], top: [0, 1, 0], three_quarter: [1, 0.65, 1.45],
};
const VIEW_LABEL = { front: 'FRONT (+Z)', back: 'BACK (-Z)', left: 'LEFT side (+X)', right: 'RIGHT side (-X)', top: 'TOP (front ↓)', three_quarter: '3/4 (front-left)' };

function modelBounds(obj = modelRoot) {
  // Parts rebuilt since the last frame still have stale matrices: refresh them first,
  // otherwise renders requested right after an edit get framed on the wrong area.
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  obj.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
  if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 4, 2));
  return box;
}

function placeCamera(cam, view, box, aspect = 1) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dir = new THREE.Vector3(...VIEW_DIRS[view]).normalize();
  const radius = size.length() / 2 || 2;
  cam.up.set(0, 1, 0);
  if (view === 'top') cam.up.set(0, 0, -1);
  if (cam.isOrthographicCamera) {
    const extents = { front: [size.x, size.y], back: [size.x, size.y], left: [size.z, size.y], right: [size.z, size.y], top: [size.x, size.z] }[view];
    const half = Math.max(extents[0] / aspect, extents[1]) / 2 * 1.15 + 0.1;
    cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half;
    cam.near = 0.01; cam.far = radius * 10 + 100;
    cam.position.copy(center).addScaledVector(dir, radius * 4 + 10);
  } else {
    const vfov = cam.fov * DEG;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = radius / Math.sin(Math.min(vfov, hfov) / 2) * 1.05;
    cam.position.copy(center).addScaledVector(dir, dist);
  }
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  return center;
}

function viewMainCamera(view) {
  const box = modelBounds();
  const center = placeCamera(camera, view === 'top' ? 'top' : view, box, camera.aspect);
  camera.up.set(0, 1, 0);
  if (view === 'top') camera.position.z += 0.001; // avoid gimbal lock for orbit controls
  orbit.target.copy(center);
}

// ---- Offscreen "studio" renders: model, 3D scan, silhouettes -----------------
const ALL_VIEWS = ['front', 'back', 'left', 'right', 'top', 'three_quarter'];
const STUDIO_BG = new THREE.Color('#d4d6da');
const BLACK = new THREE.Color('#000000');
const maskMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
const orthoCam = new THREE.OrthographicCamera();
const perspCam = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
const headlight = new THREE.DirectionalLight('#ffffff', 1.1);
let offRenderer = null;

// Runs fn() with helpers hidden and a neutral studio setup, then restores the viewport.
function studio(fn) {
  if (!offRenderer) {
    offRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    offRenderer.outputColorSpace = THREE.SRGBColorSpace;
    offRenderer.setPixelRatio(1);
  }
  const hidden = [grid, axes, gizmoHelper, selBox];
  const vis = hidden.map((o) => o.visible);
  const meshVis = meshRef.root.visible;
  hidden.forEach((o) => (o.visible = false));
  selEdgeMat.visible = false;
  const bg = scene.background;
  scene.add(headlight, headlight.target);
  meshRef.setOpaque(true);
  try { return fn(); }
  finally {
    scene.remove(headlight, headlight.target);
    scene.background = bg;
    scene.overrideMaterial = null;
    edgeMat.visible = true;
    selEdgeMat.visible = true;
    modelRoot.visible = true;
    meshRef.root.visible = meshVis;
    meshRef.setOpaque(false);
    hidden.forEach((o, i) => (o.visible = vis[i]));
  }
}

// Perspective camera at a free angle (yaw 0 = front/+Z, positive yaw = toward +X; pitch = looking down).
const photoCam = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
function placePhotoCamera(cam, { yaw = 0, pitch = 10, fov = 30 }, box) {
  cam.fov = fov;
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 2;
  const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
  cam.up.set(0, 1, 0);
  cam.position.copy(center).addScaledVector(dir, (radius / Math.sin((fov * DEG) / 2)) * 1.05);
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  return center;
}

// One tile: subject 'model' | 'mesh'; mask = white silhouette on black.
// `view` is a named view ('front', …) or a free camera { yaw, pitch, fov }.
function shoot(view, box, T, subject, mask = false) {
  offRenderer.setSize(T, T);
  modelRoot.visible = subject === 'model';
  meshRef.root.visible = subject === 'mesh' && meshRef.loaded;
  const free = typeof view === 'object';
  const cam = free ? photoCam : view === 'three_quarter' ? perspCam : orthoCam;
  const center = free ? placePhotoCamera(cam, view, box) : placeCamera(cam, view, box, 1);
  headlight.position.copy(cam.position).add(new THREE.Vector3(0, box.getSize(new THREE.Vector3()).y, 0));
  headlight.target.position.copy(center);
  scene.overrideMaterial = mask ? maskMat : null;
  scene.background = mask ? BLACK : STUDIO_BG;
  edgeMat.visible = !mask;
  offRenderer.render(scene, cam);
  const c = document.createElement('canvas');
  c.width = c.height = T;
  c.getContext('2d', { willReadFrequently: true }).drawImage(offRenderer.domElement, 0, 0);
  return c;
}

function label(ctx, x, y, text, w = 200) {
  ctx.fillStyle = '#000a'; ctx.fillRect(x, y, w, 24);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Segoe UI, sans-serif'; ctx.fillText(text, x + 7, y + 17);
}

function sheetOf(tiles, cols, T) {
  const rows = Math.ceil(tiles.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = Math.min(cols, tiles.length) * T; sheet.height = rows * T;
  const ctx = sheet.getContext('2d');
  tiles.forEach(({ canvas, text, w }, i) => {
    const x = (i % cols) * T, y = Math.floor(i / cols) * T;
    ctx.drawImage(canvas, x, y);
    ctx.strokeStyle = '#999'; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    label(ctx, x, y, text, w);
  });
  return sheet.toDataURL('image/jpeg', 0.88);
}

const hasCubes = () => S.model.parts.some((p) => p.type === 'cube' && p.visible !== false);
const meshBounds = () => modelBounds(meshRef.root);
function unionBounds() {
  if (!meshRef.loaded) return modelBounds();
  const b = meshBounds();
  return hasCubes() ? b.union(modelBounds()) : b;
}

function renderSheet(views) {
  views = views?.length ? views : ALL_VIEWS;
  return studio(() => {
    const box = modelBounds();
    return sheetOf(views.map((v) => ({ canvas: shoot(v, box, 512, 'model'), text: VIEW_LABEL[v] || v })), 3, 512);
  });
}

function meshSheet(views) {
  views = views?.length ? views : ALL_VIEWS;
  return studio(() => {
    const box = meshBounds();
    return sheetOf(views.map((v) => ({ canvas: shoot(v, box, 512, 'mesh'), text: `SCAN ${VIEW_LABEL[v] || v}`, w: 230 })), 3, 512);
  });
}

// Scan vs model with identical cameras. Model tiles are tinted:
// red = scan has mass the model lacks, blue = model has mass the scan lacks.
function compareSheet(views) {
  views = views?.length ? views : ALL_VIEWS;
  const T = 384;
  const iou = {};
  const image = studio(() => {
    const box = unionBounds();
    const tiles = [];
    for (const v of views) {
      const scan = shoot(v, box, T, 'mesh');
      const model = shoot(v, box, T, 'model');
      const mA = shoot(v, box, T, 'mesh', true).getContext('2d').getImageData(0, 0, T, T).data;
      const mB = shoot(v, box, T, 'model', true).getContext('2d').getImageData(0, 0, T, T).data;
      const mctx = model.getContext('2d');
      const img = mctx.getImageData(0, 0, T, T);
      let inter = 0, uni = 0;
      for (let i = 0; i < mA.length; i += 4) {
        const a = mA[i] > 128, b = mB[i] > 128;
        if (a || b) uni++;
        if (a && b) inter++;
        else if (a) { img.data[i] = img.data[i] * 0.3 + 230 * 0.7; img.data[i + 1] *= 0.3; img.data[i + 2] *= 0.3; }
        else if (b) { img.data[i] *= 0.3; img.data[i + 1] = img.data[i + 1] * 0.3 + 90 * 0.7; img.data[i + 2] = img.data[i + 2] * 0.3 + 255 * 0.7; }
      }
      mctx.putImageData(img, 0, 0);
      iou[v] = uni ? Math.round((inter / uni) * 1000) / 1000 : 1;
      tiles.push({ canvas: scan, text: `SCAN ${VIEW_LABEL[v] || v}`, w: 230 });
      tiles.push({ canvas: model, text: `MODEL ${v} IoU ${iou[v].toFixed(2)}`, w: 230 });
    }
    return sheetOf(tiles, 4, T);
  });
  return { image, iou };
}

// ---- Local auto-orient: match the picture's cut-out against the scan at 4 yaws ----
// Both are cropped to their silhouette, scaled into a 64×64 box, then compared by
// silhouette overlap (IoU) and color difference inside the overlap.
const N = 64;
function normalizedTile(source, alphaOf) {
  const w = source.width, h = source.height;
  const ctx = source.getContext ? source.getContext('2d', { willReadFrequently: true }) : null;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alphaOf(data, (y * w + x) * 4)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) throw new Error('empty silhouette');
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = (N - 2) / Math.max(bw, bh);
  const mask = new Uint8Array(N * N), rgb = new Float32Array(N * N * 3);
  const ox = (N - bw * s) / 2, oy = (N - bh * s) / 2;
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const sx = Math.floor(x0 + (tx - ox) / s), sy = Math.floor(y0 + (ty - oy) / s);
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1) continue;
    const o = (sy * w + sx) * 4;
    if (!alphaOf(data, o)) continue;
    const k = ty * N + tx;
    mask[k] = 1; rgb[k * 3] = data[o]; rgb[k * 3 + 1] = data[o + 1]; rgb[k * 3 + 2] = data[o + 2];
  }
  return { mask, rgb, aspect: bw / bh };
}
function tileScore(a, b) {
  let inter = 0, uni = 0, cdiff = 0;
  const lum = (t, k) => 0.3 * t.rgb[k * 3] + 0.59 * t.rgb[k * 3 + 1] + 0.11 * t.rgb[k * 3 + 2];
  // Compare brightness relative to each tile's mean (lighting differs between photo and render).
  const mean = (t) => { let s = 0, n = 0; for (let k = 0; k < N * N; k++) if (t.mask[k]) { s += lum(t, k); n++; } return s / (n || 1); };
  const ma = mean(a), mb = mean(b);
  for (let k = 0; k < N * N; k++) {
    if (a.mask[k] || b.mask[k]) uni++;
    if (a.mask[k] && b.mask[k]) { inter++; cdiff += Math.abs((lum(a, k) - ma) - (lum(b, k) - mb)) / 255; }
  }
  const iou = inter / (uni || 1);
  return iou - 0.8 * (cdiff / (inter || 1)) - 0.5 * Math.abs(Math.log(a.aspect / b.aspect));
}
async function autoOrient(url) {
  const ref = normalizedTile(await imageCanvas(url), (d, o) => d[o + 3] > 128);
  const orig = { yaw: meshRef.yaw, height: meshRef.height };
  const scores = [];
  try {
    studio(() => {
      for (const yaw of [0, 90, 180, 270]) {
        meshRef.setTransform({ yaw, height: orig.height });
        const tile = shoot('front', meshBounds(), 256, 'mesh');
        // studio background is a flat light grey: anything clearly different is the scan
        const bg = [212, 214, 218];
        const t = normalizedTile(tile, (d, o) => Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) > 18);
        scores.push({ yaw, score: tileScore(ref, t) });
      }
    });
  } finally { meshRef.setTransform(orig); }
  scores.sort((p, q) => q.score - p.score);
  return { yaw: scores[0].yaw, scores };
}

// ---- Picture matching: find the picture's camera, then compare model vs picture 1:1 ----
// createImageBitmap (not img.decode) so this also works while the editor tab is in the background.
async function imageCanvas(url) {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
  return c;
}
function bboxOf(canvas, test) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (test(d, (y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const maskIoU = (a, b) => { let i = 0, u = 0; for (let k = 0; k < N * N; k++) { if (a.mask[k] || b.mask[k]) u++; if (a.mask[k] && b.mask[k]) i++; } return i / (u || 1); };

// Search yaw/pitch so the scan's silhouette matches the picture's cut-out.
async function matchPhoto(url) {
  await requireMesh();
  const ref = normalizedTile(await imageCanvas(url), (d, o) => d[o + 3] > 128);
  // AI pictures often use a wide lens, so the lens (fov) is searched too; otherwise the
  // matcher fakes the perspective with a wrong yaw.
  let best = { yaw: 0, pitch: 10, fov: 30, score: -1 };
  studio(() => {
    const box = meshBounds();
    const test = (yaw, pitch, fov) => {
      const t = normalizedTile(shoot({ yaw, pitch, fov }, box, 160, 'mesh', true), (d, o) => d[o] > 128);
      const s = maskIoU(ref, t);
      if (s > best.score) best = { yaw, pitch, fov, score: s };
    };
    for (const fov of [25, 45, 65]) for (let yaw = -60; yaw <= 60; yaw += 10) for (let pitch = -10; pitch <= 40; pitch += 10) test(yaw, pitch, fov);
    let b = { ...best };
    for (const fov of [b.fov - 10, b.fov, b.fov + 10].filter((f) => f >= 15 && f <= 80))
      for (let yaw = b.yaw - 6; yaw <= b.yaw + 6; yaw += 3) for (let pitch = b.pitch - 6; pitch <= b.pitch + 6; pitch += 3) test(yaw, pitch, fov);
    b = { ...best };
    for (let yaw = b.yaw - 2; yaw <= b.yaw + 2; yaw += 1) for (let pitch = b.pitch - 2; pitch <= b.pitch + 2; pitch += 1) test(yaw, pitch, b.fov);
  });
  return { yaw: best.yaw, pitch: best.pitch, fov: best.fov, score: Math.round(best.score * 1000) / 1000 };
}

// [your picture | model from the picture's camera | difference]. The model render is lined up
// with the picture using the scan's silhouette (same camera), so a wrong model can't shift it.
async function pictureCompare(url, cam) {
  const T = 512;
  const src = await imageCanvas(url);
  const bb = bboxOf(src, (d, o) => d[o + 3] > 128);
  if (!bb) throw new Error('the picture cut-out is empty');
  const side = Math.max(bb.w, bb.h) * 1.12, sx = bb.x + bb.w / 2 - side / 2, sy = bb.y + bb.h / 2 - side / 2;
  const tile = (bg) => { const c = document.createElement('canvas'); c.width = c.height = T; const g = c.getContext('2d', { willReadFrequently: true }); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, T, T); } return [c, g]; };
  const [pic, pg] = tile('#d4d6da'); pg.drawImage(src, sx, sy, side, side, 0, 0, T, T);
  const [picA, pag] = tile(null); pag.drawImage(src, sx, sy, side, side, 0, 0, T, T);
  const Bp = { x: (bb.x - sx) * T / side, y: (bb.y - sy) * T / side, w: bb.w * T / side, h: bb.h * T / side };

  let modelImg, modelMask, Bs;
  studio(() => {
    const box = unionBounds();
    modelImg = shoot(cam, box, T, 'model');
    modelMask = shoot(cam, box, T, 'model', true);
    Bs = meshRef.loaded ? bboxOf(shoot(cam, box, T, 'mesh', true), (d, o) => d[o] > 128) : null;
  });
  Bs = Bs || bboxOf(modelMask, (d, o) => d[o] > 128);
  if (!Bs) throw new Error('nothing to compare yet (empty model)');
  const s = (Bp.w / Bs.w + Bp.h / Bs.h) / 2;
  const dx = Bp.x + Bp.w / 2 - (Bs.x + Bs.w / 2) * s, dy = Bp.y + Bp.h / 2 - (Bs.y + Bs.h / 2) * s;
  const place = (img, bg) => { const [c, g] = tile(bg); g.setTransform(s, 0, 0, s, dx, dy); g.drawImage(img, 0, 0); return [c, g]; };
  const [model] = place(modelImg, '#d4d6da');
  const [mMask] = place(modelMask, '#000');
  const [over, og] = place(modelImg, '#d4d6da');

  const P = pag.getImageData(0, 0, T, T).data, M = mMask.getContext('2d').getImageData(0, 0, T, T).data;
  const O = og.getImageData(0, 0, T, T);
  let inter = 0, uni = 0;
  for (let i = 0; i < P.length; i += 4) {
    const a = P[i + 3] > 128, b = M[i] > 128;
    if (a || b) uni++;
    if (a && b) inter++;
    else if (a) { O.data[i] = 230; O.data[i + 1] = 60; O.data[i + 2] = 60; }      // in picture, missing in model
    else if (b) { O.data[i] = 50; O.data[i + 1] = 110; O.data[i + 2] = 240; }     // in model, not in picture
  }
  og.putImageData(O, 0, 0);
  const iou = Math.round((inter / (uni || 1)) * 1000) / 1000;
  const image = sheetOf([
    { canvas: pic, text: 'YOUR PICTURE', w: 150 },
    { canvas: model, text: `MODEL (picture's camera)`, w: 230 },
    { canvas: over, text: `DIFFERENCE  IoU ${iou.toFixed(2)}`, w: 230 },
  ], 3, T);
  return { image, iou };
}

// ---- Auto-polish: nudge every part until the model matches the picture + scan ----------
// Targets are silhouettes: the 3D scan from 5 views, plus the picture from its matched camera
// (weighted ×2). Every part's position/size/tilt is perturbed; only improvements are kept.
const PT = 128;
function polishTargets(picture) {
  const rt = new THREE.WebGLRenderTarget(PT, PT);
  const buf = new Uint8Array(PT * PT * 4);
  const box = meshBounds().clone().expandByScalar(0.6); // fixed framing for the whole run
  const renderMask = (cam, subject) => {
    modelRoot.visible = subject === 'model';
    meshRef.root.visible = subject === 'mesh';
    scene.overrideMaterial = maskMat; scene.background = BLACK; edgeMat.visible = false;
    offRenderer.setRenderTarget(rt); offRenderer.render(scene, cam); offRenderer.setRenderTarget(null);
    offRenderer.readRenderTargetPixels(rt, 0, 0, PT, PT, buf);
    const m = new Uint8Array(PT * PT);
    for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) m[(PT - 1 - y) * PT + x] = buf[(y * PT + x) * 4] > 128 ? 1 : 0; // top-left origin
    return m;
  };
  const views = [];
  for (const v of ['front', 'back', 'left', 'right', 'top']) {
    const cam = orthoCam.clone(); placeCamera(cam, v, box, 1);
    views.push({ name: v, cam, target: renderMask(cam, 'mesh'), w: 1 });
  }
  if (picture) {
    // picture silhouette mapped into this camera's pixels via the scan's bbox (same as pictureCompare)
    const cam = photoCam.clone(); placePhotoCamera(cam, picture.cam, box);
    const scanM = renderMask(cam, 'mesh');
    let x0 = PT, y0 = PT, x1 = -1, y1 = -1;
    for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) if (scanM[y * PT + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const src = picture.canvas, bb = picture.bbox;
    const A = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data;
    const target = new Uint8Array(PT * PT);
    if (x1 >= 0) for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) {
      const sx = Math.floor(bb.x + ((x + 0.5 - x0) / (x1 - x0 + 1)) * bb.w), sy = Math.floor(bb.y + ((y + 0.5 - y0) / (y1 - y0 + 1)) * bb.h);
      if (sx >= 0 && sy >= 0 && sx < src.width && sy < src.height && A[(sy * src.width + sx) * 4 + 3] > 128) target[y * PT + x] = 1;
    }
    views.push({ name: 'picture', cam, target, w: 4 }); // the picture is the ground truth; the scan is an approximation
  }
  return { views, renderMask, dispose: () => rt.dispose() };
}

async function polishModel({ pictureUrl, cam, steps = [0.5, 0.25, 0.1] } = {}) {
  await S.meshLoading;
  if (!meshRef.loaded) throw new Error('Auto-polish needs a 3D scan of the picture first.');
  let picture = null;
  if (pictureUrl && cam) {
    const canvas = await imageCanvas(pictureUrl);
    picture = { canvas, cam, bbox: bboxOf(canvas, (d, o) => d[o + 3] > 128) };
  }
  const parts = S.model.parts.filter((p) => p.type === 'cube' && p.visible !== false && p.size[0] * p.size[1] * p.size[2] >= 0.25);
  const t0 = performance.now();
  let out;
  studio(() => {
    offRenderer.setSize(PT, PT);
    const { views, renderMask, dispose } = polishTargets(picture);
    const iouOf = (v) => { const m = renderMask(v.cam, 'model'); let i = 0, u = 0; for (let k = 0; k < m.length; k++) { const a = m[k], b = v.target[k]; if (a | b) u++; if (a & b) i++; } return i / (u || 1); };
    const score = () => { let s = 0, w = 0; for (const v of views) { s += v.w * iouOf(v); w += v.w; } return s / w; };
    const perView = () => Object.fromEntries(views.map((v) => [v.name, Math.round(iouOf(v) * 1000) / 1000]));
    const before = { score: score(), views: perView() };
    const D = Math.PI / 180;
    // Penalty for drifting from the builder's design, so a change has to buy a real improvement
    // (stops the optimizer from "gaming" the silhouette with odd tilts and squashed parts).
    const orig = new Map(parts.map((p) => { const o = objects.get(p.id); return [p.id, o && { pos: o.position.clone(), scl: o.scale.clone(), rot: o.rotation.clone() }]; }));
    const drift = (p, o) => {
      const a = orig.get(p.id);
      return 0.004 * a.pos.distanceTo(o.position) + 0.004 * a.scl.distanceTo(o.scale)
        + 0.0006 * (Math.abs(a.rot.x - o.rotation.x) + Math.abs(a.rot.y - o.rotation.y) + Math.abs(a.rot.z - o.rotation.z)) / D;
    };
    let totalDrift = 0;
    let best = before.score;
    for (const step of steps) {
      for (const p of parts) {
        const o = objects.get(p.id);
        if (!o) continue;
        // Moves: position + size on all axes; tilt only in the picture plane (z) — plus x/y
        // only for parts the builder already tilted that way (roots, leaning branches).
        const moves = [];
        for (const ax of ['x', 'y', 'z']) for (const s of [step, -step]) {
          moves.push((q) => { q.position[ax] += s; });
          moves.push((q) => { q.scale[ax] = Math.max(0.2, q.scale[ax] + s); });
        }
        for (const ax of ['z', 'x', 'y']) {
          if (ax !== 'z' && Math.abs(orig.get(p.id).rot[ax]) < 1e-3) continue;
          for (const s of [step, -step]) moves.push((q) => { q.rotation[ax] += s * 10 * D; });
        }
        for (const move of moves) {
          const prev = { pos: o.position.clone(), scl: o.scale.clone(), rot: o.rotation.clone() };
          const d0 = drift(p, o);
          move(o);
          const d1 = drift(p, o);
          const s = score();
          if (s - (totalDrift - d0 + d1) > best - totalDrift + 1e-4) { best = s; totalDrift += d1 - d0; }
          else { o.position.copy(prev.pos); o.scale.copy(prev.scl); o.rotation.copy(prev.rot); }
        }
      }
    }
    // Changed parts → absolute updates for the server
    const updates = [];
    for (const p of parts) {
      const o = objects.get(p.id); const pp = pivotOf(p.parent);
      const pos = [o.position.x + pp[0], o.position.y + pp[1], o.position.z + pp[2]].map(r3);
      const size = o.scale.toArray().map(r3), rot = [o.rotation.x, o.rotation.y, o.rotation.z].map((v) => r3(v / D));
      const diff = (a, b, e) => a.some((v, i) => Math.abs(v - b[i]) > e);
      if (diff(pos, p.position, 0.01) || diff(size, p.size, 0.01) || diff(rot, p.rotation, 0.1)) updates.push({ id: p.id, position: pos, size, rotation: rot });
    }
    out = { updates, before, after: { score: best, views: perView() }, seconds: Math.round((performance.now() - t0) / 1000) };
    dispose();
  });
  return out;
}

// Colors straight from the picture: render each part with a unique ID color from the picture's
// camera, line it up with the picture, and take each part's median picture color.
async function pictureColors({ pictureUrl, cam }) {
  await S.meshLoading;
  const src = await imageCanvas(pictureUrl);
  const bb = bboxOf(src, (d, o) => d[o + 3] > 128);
  const T = 256, rt = new THREE.WebGLRenderTarget(T, T), buf = new Uint8Array(T * T * 4);
  const cubes = S.model.parts.filter((p) => p.type === 'cube' && p.visible !== false);
  const idOf = new Map();
  let ids, scanB = null;
  studio(() => {
    offRenderer.setSize(T, T);
    const box = unionBounds();
    const pc = photoCam.clone(); placePhotoCamera(pc, cam, box);
    // scan bbox under the picture camera (alignment anchor)
    if (meshRef.loaded) {
      modelRoot.visible = false; meshRef.root.visible = true;
      scene.overrideMaterial = maskMat; scene.background = BLACK; edgeMat.visible = false;
      offRenderer.setRenderTarget(rt); offRenderer.render(scene, pc); offRenderer.setRenderTarget(null);
      offRenderer.readRenderTargetPixels(rt, 0, 0, T, T, buf);
      let x0 = T, y0 = T, x1 = -1, y1 = -1;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (buf[(y * T + x) * 4] > 128) { const yy = T - 1 - y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); }
      if (x1 >= 0) scanB = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
    // ID render of the model
    const saved = [];
    cubes.forEach((p, i) => {
      const o = objects.get(p.id); if (!o) return;
      const id = i + 1; idOf.set(id, p.id);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, 0, THREE.LinearSRGBColorSpace) });
      saved.push([o, o.material]); o.material = mat;
    });
    modelRoot.visible = true; meshRef.root.visible = false;
    scene.overrideMaterial = null; scene.background = BLACK; edgeMat.visible = false;
    offRenderer.setRenderTarget(rt); offRenderer.render(scene, pc); offRenderer.setRenderTarget(null);
    offRenderer.readRenderTargetPixels(rt, 0, 0, T, T, buf);
    for (const [o, m] of saved) { o.material.dispose(); o.material = m; }
    ids = new Uint16Array(T * T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const k = (y * T + x) * 4; ids[(T - 1 - y) * T + x] = buf[k] + (buf[k + 1] << 8); }
  });
  rt.dispose();
  // model bbox as fallback anchor
  if (!scanB) {
    let x0 = T, y0 = T, x1 = -1, y1 = -1;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (ids[y * T + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    scanB = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  const P = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data;
  const samples = new Map();
  const E = 2; // only sample a part's interior (2 px in from its edges) — edges misalign easily
  for (let y = E; y < T - E; y++) for (let x = E; x < T - E; x++) {
    const id = ids[y * T + x]; if (!id) continue;
    if (ids[(y - E) * T + x] !== id || ids[(y + E) * T + x] !== id || ids[y * T + x - E] !== id || ids[y * T + x + E] !== id) continue;
    const sx = Math.floor(bb.x + ((x + 0.5 - scanB.x) / scanB.w) * bb.w), sy = Math.floor(bb.y + ((y + 0.5 - scanB.y) / scanB.h) * bb.h);
    if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
    const o = (sy * src.width + sx) * 4;
    if (P[o + 3] < 200) continue;
    if (!samples.has(id)) samples.set(id, []);
    samples.get(id).push([P[o], P[o + 1], P[o + 2]]);
  }
  // Lit color, not shadow: average the 70th–95th brightness percentile of each part's pixels
  // (the lit faces; the top 5% are specular highlights).
  const lum = (s) => 0.3 * s[0] + 0.59 * s[1] + 0.11 * s[2];
  const colors = [];
  for (const [id, arr] of samples) {
    if (arr.length < 12) continue; // too little visible to trust
    arr.sort((a, b) => lum(a) - lum(b));
    const band = arr.slice(Math.floor(arr.length * 0.7), Math.max(Math.floor(arr.length * 0.95), Math.floor(arr.length * 0.7) + 1));
    const avg = [0, 1, 2].map((c) => Math.round(band.reduce((s, x) => s + x[c], 0) / band.length));
    colors.push({ id: idOf.get(id), rgb: avg, pixels: arr.length });
  }
  return { colors };
}

// Debug handle (used when diagnosing renders from the console / tests).
window.__blockforge = { matchPhoto, pictureCompare, autoOrient, meshRef };

// Front renders of the scan at 4 yaw angles (to pick its orientation).
function yawSheet() {
  const orig = { yaw: meshRef.yaw, height: meshRef.height };
  try {
    return studio(() => sheetOf([0, 90, 180, 270].map((yaw, i) => {
      meshRef.setTransform({ yaw, height: orig.height });
      return { canvas: shoot('front', meshBounds(), 384, 'mesh'), text: `${'ABCD'[i]}: yaw ${yaw}°`, w: 130 };
    }), 4, 384));
  } finally {
    meshRef.setTransform(orig);
  }
}

// ---------------------------------------------------------------------------
// Outliner
// ---------------------------------------------------------------------------
const outlinerEl = $('#outliner');
function renderOutliner() {
  outlinerEl.innerHTML = '';
  const walk = (parentId, depth) => {
    for (const p of childrenOf(parentId)) {
      const row = document.createElement('div');
      row.className = 'node' + (p.id === S.selected ? ' selected' : '') + (p.visible === false ? ' hidden-part' : '');
      row.style.paddingLeft = 6 + depth * 14 + 'px';
      row.dataset.id = p.id;
      row.draggable = true;
      const isGroup = p.type === 'group';
      const kids = isGroup && childrenOf(p.id).length;
      row.innerHTML = `
        <span class="tw">${isGroup ? (kids ? (S.collapsed.has(p.id) ? '▸' : '▾') : '·') : ''}</span>
        ${isGroup ? '<span>📁</span>' : `<span class="sw" style="background:${p.color}"></span>`}
        <span class="nm"></span>
        <span class="eye" title="Toggle visibility">${p.visible === false ? '◌' : '◉'}</span>`;
      row.querySelector('.nm').textContent = p.name;
      row.querySelector('.tw').onclick = (e) => {
        e.stopPropagation();
        S.collapsed.has(p.id) ? S.collapsed.delete(p.id) : S.collapsed.add(p.id);
        renderOutliner();
      };
      row.querySelector('.eye').onclick = (e) => { e.stopPropagation(); cmd({ op: 'update_part', id: p.id, visible: p.visible === false }); };
      row.onclick = () => select(p.id);
      row.ondblclick = () => renamePart(p);
      row.ondragstart = (e) => { e.dataTransfer.setData('text/part', p.id); };
      row.ondragover = (e) => { if (isGroup && e.dataTransfer.types.includes('text/part')) { e.preventDefault(); row.classList.add('drop-target'); } };
      row.ondragleave = () => row.classList.remove('drop-target');
      row.ondrop = (e) => {
        e.preventDefault(); e.stopPropagation(); row.classList.remove('drop-target');
        const id = e.dataTransfer.getData('text/part');
        if (id && id !== p.id) cmd({ op: 'update_part', id, parent: p.id });
      };
      outlinerEl.appendChild(row);
      if (isGroup && !S.collapsed.has(p.id)) walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
}
outlinerEl.ondragover = (e) => { if (e.dataTransfer.types.includes('text/part')) e.preventDefault(); };
outlinerEl.ondrop = (e) => {
  const id = e.dataTransfer.getData('text/part');
  if (id) { e.preventDefault(); cmd({ op: 'update_part', id, parent: null }); }
};

function renamePart(p) {
  const name = prompt('Rename part', p.name);
  if (name && name !== p.name) cmd({ op: 'update_part', id: p.id, name });
}

function select(id) {
  S.selected = id && partById(id) ? id : null;
  applySelection();
  renderOutliner();
  renderProps();
  updateStats();
  const row = S.selected && outlinerEl.querySelector(`[data-id="${S.selected}"]`);
  if (row) {
    const top = row.offsetTop - outlinerEl.offsetTop;
    if (top < outlinerEl.scrollTop || top > outlinerEl.scrollTop + outlinerEl.clientHeight - row.offsetHeight) outlinerEl.scrollTop = top - 40;
  }
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------
const propsEl = $('#props');
function v3Input(key, val, step = 0.1) {
  return `<div class="v3" data-key="${key}">${val.map((v) => `<input type="number" step="${step}" value="${v}">`).join('')}</div>`;
}
function renderProps() {
  const p = S.selected && partById(S.selected);
  if (!p) { propsEl.innerHTML = '<p class="muted pad">Select a part.</p>'; return; }
  const groups = S.model.parts.filter((x) => x.type === 'group' && x.id !== p.id);
  const parentOpts = `<option value="">(root)</option>` + groups.map((g) => `<option value="${g.id}" ${g.id === p.parent ? 'selected' : ''}>${g.name}</option>`).join('');
  let html = `<div class="prop-grid">
    <label>Name</label><input type="text" data-key="name" value="">
    <label>Parent</label><select data-key="parent">${parentOpts}</select>`;
  if (p.type === 'group') {
    html += `<label>Pivot</label>${v3Input('pivot', p.pivot)}
      <label>Rotation</label>${v3Input('rotation', p.rotation, 5)}`;
  } else {
    html += `<label>Position</label>${v3Input('position', p.position)}
      <label>Size</label>${v3Input('size', p.size)}
      <label>Rotation</label>${v3Input('rotation', p.rotation, 5)}
      <label>Color</label><div class="row"><input type="color" data-key="color" value="${p.color}"><input type="text" data-key="color" value="${p.color}" style="width:90px"></div>
      <label>Shape</label><select data-key="shape">${['box', 'cylinder', 'sphere', 'wedge'].map((s) => `<option ${s === p.shape ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label>Material</label><select data-key="material">${MATERIAL_LIST.map((s) => `<option ${s === p.material ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
  }
  html += `</div><p class="muted pad small">${p.id} · ${p.type}${p.type === 'group' ? ` · ${childrenOf(p.id).length} children` : ''}</p>`;
  propsEl.innerHTML = html;
  propsEl.querySelector('[data-key=name]').value = p.name;

  propsEl.querySelectorAll('[data-key]').forEach((el) => {
    const key = el.dataset.key;
    if (el.classList.contains('v3')) {
      el.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
        const vals = [...el.querySelectorAll('input')].map((i) => parseFloat(i.value) || 0);
        cmd({ op: 'update_part', id: p.id, [key]: vals });
      }));
    } else {
      el.addEventListener('change', () => {
        let v = el.value;
        if (key === 'parent') v = v || null;
        cmd({ op: 'update_part', id: p.id, [key]: v });
      });
    }
  });
}

function updateStats() {
  const cubes = S.model.parts.filter((p) => p.type === 'cube').length;
  const groups = S.model.parts.length - cubes;
  const sel = S.selected && partById(S.selected);
  $('#stats').textContent = `${cubes} cubes · ${groups} groups${sel ? ` · selected: ${sel.name}` : ''}  —  W/E/R gizmo · F focus · Del delete · Ctrl+D duplicate · hold Shift for free snapping`;
}

// ---------------------------------------------------------------------------
// Refs, log, job state
// ---------------------------------------------------------------------------
function renderRefs() {
  const el = $('#refs');
  el.innerHTML = '';
  for (const r of S.refs) {
    const d = document.createElement('div');
    d.className = 'ref';
    d.title = r.description || r.label;
    d.innerHTML = `<img loading="lazy"><span></span><button title="Delete">✕</button>`;
    d.querySelector('img').src = r.url;
    d.querySelector('span').textContent = r.label;
    d.onclick = () => openLightbox(r.url);
    d.querySelector('button').onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`Delete reference "${r.label}"?`)) await api('/api/refs/delete', { file: r.file });
    };
    el.appendChild(d);
  }
}

function renderPlan() {
  const plan = S.project?.plan;
  $('#plan').innerHTML = plan
    ? `<b>Plan:</b> ${plan.parts.map((p) => p.name).join(', ')} · ~${plan.dimensions.width_x}×${plan.dimensions.height_y}×${plan.dimensions.length_z} studs` +
      `<div class="row wrap">${plan.palette.map((c) => `<span class="sw" title="${c.name}" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${c.hex}"></span>`).join('')}</div>`
    : '';
}

const logEl = $('#log');
function addLog(entry) {
  const d = document.createElement('div');
  d.className = 'log ' + entry.kind;
  const t = new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  d.innerHTML = `<time>${t}</time>`;
  d.append(document.createTextNode(entry.text));
  if (entry.image) {
    const img = document.createElement('img');
    img.src = entry.image;
    img.onclick = () => openLightbox(entry.image);
    d.appendChild(img);
  }
  logEl.appendChild(d);
  while (logEl.children.length > 300) logEl.firstChild.remove();
  const right = $('#right');
  right.scrollTop = right.scrollHeight;
}

function setJob(job) {
  S.job = job;
  const badge = $('#jobBadge');
  badge.hidden = !job;
  badge.textContent = job ? `${job}…` : '';
  $('#btnStop').hidden = !job;
  ['#btnRun', '#btnFromImage', '#btnStepRefs', '#btnStepPlan', '#btnStepMesh', '#btnStepParts', '#btnStepBuild', '#btnBlockify', '#btnCompare'].forEach((s) => ($(s).disabled = !!job || ((s === '#btnBlockify' || s === '#btnCompare') && !S.mesh)));
}

function updateKeyWarning() {
  const w = [];
  if (S.imageNeedsKey) w.push(`Images (${S.imageName}) need a key.`);
  if (!S.hasLLM) w.push(`AI brain (${S.llmName}) needs a key — Google Gemini is free. Or drive the editor from Claude Code via MCP.`);
  $('#keyWarning').hidden = !w.length;
  $('#keyWarning').innerHTML = w.join('<br>') + (w.length ? ' <a href="#" id="lnkSettings">Open Settings</a>' : '');
  $('#lnkSettings')?.addEventListener('click', (e) => { e.preventDefault(); openSettings(); });
}

function openLightbox(src) {
  $('#lightbox img').src = src;
  $('#lightbox').hidden = false;
}
$('#lightbox').onclick = () => ($('#lightbox').hidden = true);

// ---------------------------------------------------------------------------
// Server events
// ---------------------------------------------------------------------------
function applyModel(model) {
  S.model = model;
  $('#surfaceSelect').value = model.style || 'smooth';
  if (S.selected && !partById(S.selected)) S.selected = null;
  rebuildScene();
  renderOutliner();
  if (!propsEl.contains(document.activeElement)) renderProps();
}
function applyProject(project) {
  S.project = project;
  $('#projectName').textContent = project ? `${project.name}` : '';
  if (project && document.activeElement !== $('#subject')) $('#subject').value = project.subject || '';
  if (project?.preset) $('#presetSelect').value = project.preset;
  renderPlan();
  applyMesh(project?.mesh || null);
}

// ---- 3D scan reference --------------------------------------------------------
S.mesh = null;
S.meshLoading = Promise.resolve();
function applyMesh(mesh) {
  const prev = S.mesh;
  S.mesh = mesh;
  renderMeshPanel();
  if (!mesh) { meshRef.unload(); return; }
  if (prev?.url === mesh.url && meshRef.loaded) {
    if (!!prev.linear !== !!mesh.linear) meshRef.setLinear(mesh.linear);
    if (prev.yaw !== mesh.yaw || prev.height !== mesh.height) meshRef.setTransform(mesh);
    return;
  }
  S.meshLoading = meshRef.load(mesh.url, mesh)
    .then(() => { meshRef.ghost = $('#chkGhost').checked; meshRef.applyGhost(); })
    .catch((e) => addLog({ kind: 'error', text: '3D scan failed to load: ' + e.message, time: Date.now() }));
}
async function requireMesh() {
  await S.meshLoading;
  if (!meshRef.loaded) throw new Error('No 3D scan in this project — generate one (3D scan step) or upload a .glb first.');
}

function renderMeshPanel() {
  const m = S.mesh;
  $('#meshStatus').textContent = m ? `${m.source || 'scan'} · yaw ${m.yaw}° · height ${m.height} studs` : 'No 3D scan yet.';
  for (const id of ['#btnMeshYaw', '#btnMeshOrient', '#meshHeight', '#btnCompare', '#btnVsPicture', '#btnPolish', '#btnPicColors', '#btnBlockify', '#btnMeshDelete', '#meshLinear']) $(id).disabled = !m;
  if (m && document.activeElement !== $('#meshHeight')) $('#meshHeight').value = m.height;
  $('#meshLinear').checked = !!m?.linear;
}

// Server → browser compute requests (renders, measurements, blockify).
async function handleBrowserRequest({ id, op, args = {} }) {
  try {
    let result;
    switch (op) {
      case 'render': result = { image: renderSheet(args.views) }; break;
      case 'mesh_render': await requireMesh(); result = { image: meshSheet(args.views) }; break;
      case 'compare': await requireMesh(); result = compareSheet(args.views); break;
      case 'yaw_sheet': await requireMesh(); result = { image: yawSheet() }; break;
      case 'auto_orient': await requireMesh(); result = await autoOrient(args.url); break;
      case 'match_photo': result = await matchPhoto(args.url); break;
      case 'picture_compare': await S.meshLoading; result = await pictureCompare(args.url, args.cam); break;
      case 'polish': result = await polishModel(args); break;
      case 'picture_colors': result = await pictureColors(args); break;
      case 'mesh_info': await requireMesh(); result = meshRef.info(); break;
      case 'slices': await requireMesh(); result = { text: meshRef.slices(args) }; break;
      case 'blockify': await requireMesh(); result = meshRef.blockify(args); break;
      case 'export_rbxmx': result = exportRbxmx(S.model, buildModelObject); break;
      default: throw new Error(`Unknown browser op ${op}`);
    }
    await api('/api/browser-result', { id, result });
  } catch (e) {
    await api('/api/browser-result', { id, error: e.message }).catch(() => {});
  }
}

async function init() {
  const st = await api('/api/state');
  Object.assign(S, { refs: st.refs, hasOpenAI: st.hasOpenAI, hasLLM: st.hasLLM, llmName: st.llmName, imageName: st.imageName, imageNeedsKey: st.imageNeedsKey, config: st.config });
  $('#presetSelect').innerHTML = st.presets.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  applyProject(st.project);
  applyModel(st.model);
  renderRefs();
  logEl.innerHTML = '';
  st.logs.forEach(addLog);
  setJob(st.job);
  setUndo(st.canUndo, st.canRedo);
  updateKeyWarning();
  if (S.model.parts.length) viewMainCamera('three_quarter');

  const es = new EventSource('/api/events');
  es.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case 'model': applyModel(m.model); setUndo(m.canUndo, m.canRedo); break;
      case 'project':
        if (m.project) applyProject(m.project);
        if (m.model) { S.selected = null; applyModel(m.model); viewMainCamera('three_quarter'); }
        if (m.refs) { S.refs = m.refs; renderRefs(); }
        break;
      case 'refs': S.refs = m.refs; renderRefs(); break;
      case 'log': addLog(m); break;
      case 'job': setJob(m.job); break;
      case 'browser_request': handleBrowserRequest(m); break;
      case 'hello':
        if (S.boot && S.boot !== m.boot) location.reload(); // server restarted with new code
        S.boot = m.boot;
        break;
    }
  };
}
function setUndo(u, r) { $('#btnUndo').disabled = !u; $('#btnRedo').disabled = !r; }

// ---------------------------------------------------------------------------
// Toolbar + actions
// ---------------------------------------------------------------------------
function spawnPoint() {
  const sel = S.selected && partById(S.selected);
  if (sel?.type === 'cube') return [sel.position[0] + 1, sel.position[1], sel.position[2]];
  return [0, 0.5, 0];
}
function targetGroup() {
  const sel = S.selected && partById(S.selected);
  return sel ? (sel.type === 'group' ? sel.id : sel.parent) : null;
}
$('#btnAddCube').onclick = async () => {
  const r = await cmd({ op: 'add_cube', name: 'cube', parent: targetGroup(), position: spawnPoint(), size: [1, 1, 1], color: '#a3a2a5' });
  if (r) select(r.id);
};
$('#btnAddGroup').onclick = async () => {
  const sel = S.selected && partById(S.selected);
  const r = await cmd({ op: 'add_group', name: 'group', parent: targetGroup(), pivot: sel?.type === 'cube' ? sel.position : [0, 0, 0] });
  if (r) select(r.id);
};
const duplicate = async () => {
  if (!S.selected) return;
  const r = await cmd({ op: 'duplicate_part', id: S.selected, offset: [0.5, 0, 0] });
  if (r?.created?.[0]) select(r.created[0].split(':')[0]);
};
const del = () => S.selected && cmd({ op: 'delete_part', id: S.selected });
$('#btnDuplicate').onclick = duplicate;
$('#btnDelete').onclick = del;
$('#btnMirror').onclick = async () => {
  if (!S.selected) return;
  const r = await cmd({ op: 'mirror_part', id: S.selected, axis: 'x' });
  if (r?.created?.[0]) select(r.created[0].split(':')[0]);
};
$('#btnUndo').onclick = () => api('/api/undo', {});
$('#btnRedo').onclick = () => api('/api/redo', {});
document.querySelectorAll('#modeButtons button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$('#viewSelect').onchange = (e) => { if (e.target.value) viewMainCamera(e.target.value); e.target.value = ''; };
$('#surfaceSelect').onchange = (e) => cmd({ op: 'set_style', style: e.target.value });
$('#chkGrid').onchange =(e) => { grid.visible = axes.visible = e.target.checked; };

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') { gizmo.setTranslationSnap(null); gizmo.setRotationSnap(null); gizmo.setScaleSnap(null); }
  if (e.target.closest('input, textarea, select, dialog')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'z') { e.preventDefault(); e.shiftKey ? api('/api/redo', {}) : api('/api/undo', {}); }
  else if (e.ctrlKey && k === 'y') { e.preventDefault(); api('/api/redo', {}); }
  else if (e.ctrlKey && k === 'd') { e.preventDefault(); duplicate(); }
  else if (k === 'delete' || k === 'backspace') del();
  else if (k === 'w') setMode('translate');
  else if (k === 'e') setMode('rotate');
  else if (k === 'r') setMode('scale');
  else if (k === 'escape') select(null);
  else if (k === 'f') {
    const obj = S.selected ? objects.get(S.selected) : modelRoot;
    const box = modelBounds(obj);
    const c = box.getCenter(new THREE.Vector3());
    const dist = Math.max(box.getSize(new THREE.Vector3()).length() * 1.4, 3);
    camera.position.copy(c).add(camera.position.clone().sub(orbit.target).normalize().multiplyScalar(dist));
    orbit.target.copy(c);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') { gizmo.setTranslationSnap(0.1); gizmo.setRotationSnap(15 * DEG); gizmo.setScaleSnap(0.1); }
});

// AI pipeline buttons
const subject = () => $('#subject').value.trim();
const notes = () => $('#notes').value.trim();
const reviewRounds = () => Math.max(0, parseInt($('#reviewRounds').value, 10) || 0);
async function run(path, body = {}) {
  try { await api(path, body); } catch (e) { addLog({ kind: 'error', text: e.message, time: Date.now() }); }
}
$('#subject').addEventListener('change', () => run('/api/projects/subject', { subject: subject() }));
$('#btnRun').onclick = () => {
  const own = S.refs.filter((r) => r.kind === 'user');
  if (own.length && $('#stepRefs').checked &&
      confirm(`You added your own image (${own.map((r) => r.label).join(', ')}).\n\nOK = build the model from your image (no new pictures generated).\nCancel = generate brand-new reference pictures instead.`)) {
    return run('/api/pipeline/from-image', { subject: subject(), notes: notes(), reviewRounds: reviewRounds() });
  }
  runFullPipeline();
};
const runFullPipeline = () => run('/api/pipeline/run', {
  subject: subject(), notes: notes(), reviewRounds: reviewRounds(),
  steps: { references: $('#stepRefs').checked, mesh: $('#stepMesh').checked, parts: $('#stepParts').checked, build: $('#stepBuild').checked },
});
$('#btnStepMesh').onclick = () => run('/api/pipeline/mesh');
$('#btnFromImage').onclick = () => {
  if (!S.refs.length) { $('#fileRef').click(); return addLog({ kind: 'info', text: 'Pick your image (e.g. a photo or drawing of a tree), then click "Build from my image" again.', time: Date.now() }); }
  run('/api/pipeline/from-image', { subject: subject(), notes: notes(), reviewRounds: reviewRounds() });
};
$('#presetSelect').onchange = (e) => run('/api/projects/preset', { preset: e.target.value });
$('#btnSnap').onclick = () => cmd({ op: 'roblox_snap' });
$('#btnExportRoblox').onclick = () => {
  const { xml, parts } = exportRbxmx(S.model, buildModelObject);
  download(fileBase() + '.rbxmx', xml, 'application/xml');
  addLog({ kind: 'info', text: `Exported ${parts} parts to ${fileBase()}.rbxmx — drag it into Roblox Studio.`, time: Date.now() });
};

// 3D scan panel
$('#chkGhost').onchange = (e) => { meshRef.ghost = e.target.checked; meshRef.applyGhost(); };
$('#btnMeshYaw').onclick = () => S.mesh && run('/api/mesh/transform', { yaw: (S.mesh.yaw + 90) % 360 });
$('#meshHeight').onchange = (e) => { const h = parseFloat(e.target.value); if (h > 0) run('/api/mesh/transform', { height: h }); };
$('#btnCompare').onclick = () => run('/api/mesh/compare');
$('#btnVsPicture').onclick = () => run('/api/mesh/picture-compare');
$('#btnPolish').onclick = () => run('/api/mesh/polish');
$('#btnPicColors').onclick = () => run('/api/mesh/picture-colors');
$('#btnMeshOrient').onclick = () => run('/api/mesh/orient');
$('#meshLinear').onchange = (e) => run('/api/mesh/transform', { linear: e.target.checked });
$('#btnBlockify').onclick = () => run('/api/mesh/blockify', {
  res: parseInt($('#blockRes').value, 10) || 20, colors: parseInt($('#blockColors').value, 10) || 8,
});
$('#btnMeshDelete').onclick = () => confirm('Remove the 3D scan from this project?') && run('/api/mesh/delete');
$('#btnMeshUpload').onclick = () => $('#fileMesh').click();
$('#fileMesh').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
  run('/api/mesh/upload', { data: dataUrl, name: f.name });
};
$('#btnStop').onclick = () => run('/api/pipeline/stop');
$('#btnStepRefs').onclick = () => run('/api/pipeline/references', { subject: subject() });
$('#btnStepPlan').onclick = () => run('/api/pipeline/plan');
$('#btnStepParts').onclick = () => run('/api/pipeline/parts');
$('#btnStepBuild').onclick = () => run('/api/pipeline/build', { notes: notes(), reviewRounds: reviewRounds() });
$('#btnClearLog').onclick = () => (logEl.innerHTML = '');

// Reference upload (button + drag & drop)
async function uploadImages(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    await run('/api/refs/upload', { image: dataUrl, label: f.name.replace(/\.\w+$/, '') });
  }
}
$('#btnUploadRef').onclick = () => $('#fileRef').click();
$('#fileRef').onchange = (e) => { uploadImages([...e.target.files]); e.target.value = ''; };
for (const el of [viewportEl, $('#right')]) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); viewportEl.classList.add('dragging'); } });
  el.addEventListener('dragleave', () => viewportEl.classList.remove('dragging'));
  el.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault(); viewportEl.classList.remove('dragging');
    uploadImages([...e.dataTransfer.files]);
  });
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------
function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileBase = () => (S.model.name || 'model').replace(/[^\w-]+/g, '_');
$('#btnExportJson').onclick = () => download(fileBase() + '.json', JSON.stringify(S.model, null, 2), 'application/json');
$('#btnExportGlb').onclick = async () => {
  const { root } = buildModelObject(S.model, { edges: false });
  root.name = S.model.name || 'model';
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  download(fileBase() + '.glb', glb, 'model/gltf-binary');
};
$('#btnExportObj').onclick = () => {
  const { root } = buildModelObject(S.model, { edges: false });
  download(fileBase() + '.obj', new OBJExporter().parse(root), 'text/plain');
};
$('#btnImport').onclick = () => $('#fileImport').click();
$('#fileImport').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    const model = json.elements ? fromBBModel(json) : json;
    await cmd({ op: 'load_model', model });
    viewMainCamera('three_quarter');
  } catch (err) { addLog({ kind: 'error', text: 'Import failed: ' + err.message, time: Date.now() }); }
};

// Minimal BlockBench (.bbmodel) importer. BlockBench pixels → studs at 1/8.
function fromBBModel(bb) {
  const SC = 1 / 8;
  const MARKER = ['#5b8ef0', '#e6c44c', '#4cc47a', '#e0524f', '#9e66e0', '#e28a3c', '#e07ab7', '#a3a2a5'];
  const parts = [];
  let n = 1;
  const id = () => 'p' + n++;
  const els = new Map((bb.elements || []).map((e) => [e.uuid, e]));
  const addEl = (e, parent) => {
    if (!e.from || !e.to) return;
    const center = e.from.map((v, i) => r3(((v + e.to[i]) / 2) * SC));
    const size = e.from.map((v, i) => Math.max(0.05, r3(Math.abs(e.to[i] - v) * SC)));
    const cube = { id: id(), type: 'cube', name: e.name || 'cube', parent, position: center, size, rotation: [0, 0, 0], color: MARKER[e.color % 8] || '#a3a2a5', shape: 'box', material: 'plastic', visible: e.visibility !== false };
    if (e.rotation && e.rotation.some((r) => r)) {
      const g = { id: id(), type: 'group', name: (e.name || 'cube') + '_rot', parent, pivot: (e.origin || [0, 0, 0]).map((v) => r3(v * SC)), rotation: e.rotation, visible: true };
      parts.push(g);
      cube.parent = g.id;
    }
    parts.push(cube);
  };
  const walk = (nodes, parent) => {
    for (const node of nodes || []) {
      if (typeof node === 'string') { const e = els.get(node); if (e) addEl(e, parent); els.delete(node); continue; }
      const g = { id: id(), type: 'group', name: node.name || 'group', parent, pivot: (node.origin || [0, 0, 0]).map((v) => r3(v * SC)), rotation: node.rotation || [0, 0, 0], visible: node.visibility !== false };
      parts.push(g);
      walk(node.children, g.id);
    }
  };
  walk(bb.outliner, null);
  for (const e of els.values()) addEl(e, null);
  const used = new Set();
  for (const p of parts) { let nm = p.name, i = 2; while (used.has(nm)) nm = `${p.name}_${i++}`; p.name = nm; used.add(nm); }
  return { name: bb.name || 'imported', nextId: n, parts };
}

// ---------------------------------------------------------------------------
// Dialogs: projects, settings, style
// ---------------------------------------------------------------------------
const dlg = $('#dlg');
const dlgForm = $('#dlgForm');
function showDialog(html, onSubmit) {
  dlgForm.innerHTML = html;
  dlgForm.onsubmit = async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    try { if ((await onSubmit?.(e.submitter?.value)) !== false) dlg.close(); }
    catch (err) { alert(err.message); }
  };
  dlg.showModal();
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#btnProjects').onclick = async () => {
  const [{ projects, current }, batch] = await Promise.all([api('/api/projects'), api('/api/batch')]);
  const batchInfo = batch.total
    ? `Batch queue: ${batch.done}/${batch.total} scanned, ${batch.left} left${batch.failed ? `, ${batch.failed} failed` : ''}${batch.quota && batch.left ? ` · last quota stop ${new Date(batch.quota.at).toLocaleString()}${batch.quota.retryIn ? ` (try again in ${batch.quota.retryIn})` : ''}` : ''}.`
    : 'One project per image in a folder (your image as reference, Studs preset), then 3D scans until the Hugging Face quota runs out.';
  showDialog(`<h3>Projects</h3>
    <div class="field"><label class="lbl">New project</label>
      <div class="row"><input id="newProj" placeholder="e.g. Undead Skeleton Horse" class="grow"><button value="new" class="primary">Create</button></div></div>
    <div class="field"><label class="lbl">Batch import</label>
      <div class="row"><button value="batch" type="submit">Batch import folder…</button>
        <button value="resume" type="submit" ${batch.left ? '' : 'disabled'}>Resume scans${batch.left ? ` (${batch.left} left)` : ''}</button></div>
      <span class="muted small">${esc(batchInfo)}</span></div>
    <label class="lbl">Open</label>
    <div class="proj-list">${projects.map((p) => `
      <div class="proj ${p.slug === current ? 'current' : ''}" data-slug="${esc(p.slug)}">
        ${p.thumb ? `<img src="${esc(p.thumb)}">` : '<div class="ph"></div>'}
        <div><div>${esc(p.name)}</div><div class="muted small">${esc(p.subject)}</div></div>
      </div>`).join('')}</div>
    <div class="actions"><button value="cancel">Close</button></div>`,
  async (v) => {
    if (v === 'new') {
      const name = $('#newProj').value.trim();
      if (!name) return false;
      await api('/api/projects/new', { name, subject: name });
    }
    if (v === 'batch') {
      const folder = prompt('Folder with the images (full path) — one project per image, then 3D scans until the Hugging Face quota runs out:', batch.folder || '');
      if (!folder?.trim()) return false;
      await api('/api/batch/import', { folder: folder.trim() });
    }
    if (v === 'resume') await api('/api/batch/resume', {});
  });
  dlgForm.querySelectorAll('.proj').forEach((el) => (el.onclick = async () => {
    await api('/api/projects/open', { slug: el.dataset.slug });
    dlg.close();
  }));
};

async function openSettings() {
  const st = await api('/api/state');
  const c = st.config;
  const field = (k, label, type = 'text', hint = '') => `<div class="field"><label class="lbl">${label}</label>
    <input name="${k}" type="${type}" value="${type === 'password' ? '' : esc(c[k])}" placeholder="${esc(type === 'password' ? (c[k] || 'not set') : '')}">
    ${hint ? `<span class="muted small">${hint}</span>` : ''}</div>`;
  const select = (k, opts) => `<select name="${k}">${opts.map(([v, t]) => `<option value="${v}" ${v === c[k] ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const geminiKey = field('GEMINI_API_KEY', 'Google Gemini API key (free)', 'password', 'Free at aistudio.google.com → Get API key. No card needed.');
  showDialog(`<h3>Settings</h3>
    <h3 style="margin-top:4px">🧠 AI brain (plans + builds the model)</h3>
    <div class="field"><label class="lbl">Provider</label>${select('LLM_PROVIDER', [
      ['gemini', 'Google Gemini — free tier (recommended free)'], ['openrouter', 'OpenRouter — free models'], ['ollama', 'Ollama — runs on your PC (free, offline)'],
      ['openai', 'OpenAI (paid)'], ['anthropic', 'Anthropic Claude (paid)']])}</div>
    <div class="field"><label class="lbl">Model</label>
      <div class="row"><input name="LLM_MODEL" list="llmModels" value="${esc(c.LLM_MODEL)}" placeholder="blank = default for the provider" class="grow"><button type="button" id="btnLoadModels">Load models</button></div>
      <datalist id="llmModels"></datalist>
      <span class="muted small">Must read images and call tools. Defaults: Gemini gemini-3.8-flash · OpenRouter openrouter/free · Ollama qwen2.5vl</span></div>
    <div data-llm="gemini">${geminiKey}</div>
    <div data-llm="openrouter">${field('OPENROUTER_API_KEY', 'OpenRouter API key (free)', 'password', 'Free at openrouter.ai/keys.')}</div>
    <div data-llm="ollama"><p class="muted small">Install Ollama (ollama.com), then run <code>ollama pull qwen2.5vl</code>. Nothing leaves your PC, but small local models build noticeably worse models.</p></div>
    <div data-llm="anthropic">${field('ANTHROPIC_API_KEY', 'Anthropic API key', 'password')}${field('CLAUDE_MODEL', 'Claude model')}</div>
    <div data-llm="openai"><p class="muted small">Uses the OpenAI key from the Images section.</p></div>
    ${field('LLM_BASE_URL', 'Custom base URL (optional)', 'text', 'Any OpenAI-compatible endpoint (Groq, LM Studio, …). Leave blank normally.')}
    ${field('CLAUDE_MAX_TURNS', 'Max tool turns per build', 'number')}

    <h3 style="margin-top:6px">🖼️ Images (reference shots)</h3>
    <div class="field"><label class="lbl">Provider</label>${select('IMAGE_PROVIDER', [
      ['pollinations', 'Pollinations — free, no key (slow)'], ['hf_space', 'Hugging Face FLUX Space — free (uses your HF token)'], ['gemini', 'Google Gemini image — can edit (needs paid quota)'],
      ['cloudflare', 'Cloudflare Workers AI FLUX — free daily quota'], ['huggingface', 'Hugging Face (FLUX)'], ['openai', 'OpenAI GPT-Image (paid)']])}
      <span class="muted small">Providers that can't edit images make only the main view; the 3D scan then supplies the other views.</span></div>
    <div data-img="gemini">${field('GEMINI_IMAGE_MODEL', 'Gemini image model')}<p class="muted small">Uses the Gemini key${c.LLM_PROVIDER === 'gemini' ? ' from the AI brain section' : ''}.</p>${c.LLM_PROVIDER === 'gemini' ? '' : geminiKey}</div>
    <div data-img="pollinations">${field('POLLINATIONS_TOKEN', 'Pollinations token (optional)', 'password', 'Works without one. A free token (auth.pollinations.ai) removes the watermark and is faster.')}${field('POLLINATIONS_MODEL', 'Pollinations model')}</div>
    <div data-img="cloudflare">${field('CF_ACCOUNT_ID', 'Cloudflare account ID')}${field('CF_API_TOKEN', 'Cloudflare API token', 'password', 'dash.cloudflare.com → AI → Workers AI → Use REST API. Free daily allowance.')}${field('CF_IMAGE_MODEL', 'Model')}</div>
    <div data-img="openai">${field('OPENAI_API_KEY', 'OpenAI API key', 'password', 'Needs paid credits.')}${field('IMAGE_MODEL', 'Image model')}
      <div class="row"><div class="field grow"><label class="lbl">Quality</label>${select('IMAGE_QUALITY', ['low', 'medium', 'high', 'auto'].map((q) => [q, q]))}</div>
      <div class="field grow"><label class="lbl">Size</label>${select('IMAGE_SIZE', ['1024x1024', '1536x1024', '1024x1536', 'auto'].map((q) => [q, q]))}</div></div>
      ${field('OPENAI_BASE_URL', 'OpenAI base URL')}</div>
    <div data-img="huggingface">${field('HF_IMAGE_MODEL', 'HF text-to-image model')}${field('HF_EDIT_MODEL', 'HF image-edit model')}${field('HF_PROVIDER', 'HF inference provider')}</div>

    <h3 style="margin-top:6px">🧊 3D scan (Hugging Face, free)</h3>
    ${field('HF_TOKEN', 'Hugging Face token (free, recommended)', 'password', 'huggingface.co/settings/tokens → New token (Read). Gives far more free GPU time for 3D scans.')}
    <div class="field"><label class="lbl">3D scan model</label>${select('MESH_BACKEND', [['trellis', 'TRELLIS (fast)'], ['trellis2', 'TRELLIS.2 (detailed)'], ['hunyuan3d', 'Hunyuan3D-2']])}</div>
    <p class="muted small">Saved to the .env file in the app folder.</p>
    <div class="actions"><button value="cancel">Cancel</button><button value="save" class="primary">Save</button></div>`,
  async () => {
    await saveSettingsForm();
  });
  // Only show the fields for the chosen providers (duplicate key fields: keep the visible one).
  const sync = () => {
    const llm = dlgForm.querySelector('[name=LLM_PROVIDER]').value, img = dlgForm.querySelector('[name=IMAGE_PROVIDER]').value;
    dlgForm.querySelectorAll('[data-llm]').forEach((el) => (el.hidden = el.dataset.llm !== llm));
    dlgForm.querySelectorAll('[data-img]').forEach((el) => (el.hidden = el.dataset.img !== img));
  };
  dlgForm.querySelectorAll('[name=LLM_PROVIDER],[name=IMAGE_PROVIDER]').forEach((el) => (el.onchange = sync));
  sync();
  $('#btnLoadModels').onclick = async () => {
    try {
      await saveSettingsForm();
      const { models } = await api('/api/llm/models');
      $('#llmModels').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
      $('#btnLoadModels').textContent = `${models.length} models ▾`;
      dlgForm.querySelector('[name=LLM_MODEL]').focus();
    } catch (e) { alert(e.message); }
  };
}

async function saveSettingsForm() {
  const body = {};
  for (const el of dlgForm.querySelectorAll('[name]')) {
    if (el.closest('[hidden]')) continue;
    if (el.type !== 'password' || el.value) body[el.name] = el.value;
  }
  const r = await api('/api/settings', body);
  Object.assign(S, { hasOpenAI: r.hasOpenAI, hasLLM: r.hasLLM, llmName: r.llmName, imageName: r.imageName, imageNeedsKey: r.imageNeedsKey, config: r.config });
  updateKeyWarning();
}
$('#btnSettings').onclick = openSettings;

$('#btnStyle').onclick = async () => {
  const st = await api('/api/style');
  showDialog(`<h3>Image style prompt</h3>
    <p class="muted small">Prepended to every image-generation prompt. Current preset: <b>${esc(st.preset)}</b>.
    ${st.editable ? (st.custom ? 'Custom style in use.' : 'No custom style yet; using the built-in default.') : 'This preset has a built-in Roblox style (shown below, read-only). To use your own, pick “Custom (style/ folder)” as the Roblox style.'}<br>
    To learn a style: put a set of example images of Roblox-style models into <code>${esc(st.folder)}</code> and click “Learn from examples” (uses Claude).</p>
    <textarea id="styleText" rows="10" ${st.editable ? '' : 'readonly'}>${esc(st.text)}</textarea>
    <div class="actions">
      <button value="learn">Learn from examples</button>
      <button value="reset">Reset to default</button>
      <span class="grow"></span>
      <button value="cancel">Cancel</button><button value="save" class="primary">Save</button>
    </div>`,
  async (v) => {
    if (v === 'learn') return run('/api/style/learn');
    if (v === 'reset') return api('/api/style', { reset: true });
    if (!st.editable) return;
    return api('/api/style', { text: $('#styleText').value });
  });
};

init().catch((e) => addLog({ kind: 'error', text: 'Could not reach the server: ' + e.message, time: Date.now() }));
