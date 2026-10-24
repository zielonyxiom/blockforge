// 3D scan reference (GLB from TRELLIS / Hunyuan3D / upload): loading, alignment,
// ghost display, voxelization, slices (measurements) and auto-blockify.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const r2 = (n) => Math.round(n * 100) / 100;
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export class MeshRef {
  constructor(scene) {
    this.root = new THREE.Group();      // world placement (normalized)
    this.yawGroup = new THREE.Group();  // yaw correction
    this.root.add(this.yawGroup);
    this.root.visible = false;
    scene.add(this.root);
    this.loaded = false;
    this.ghost = true;
    this.opacity = 0.35;
    this.materials = [];
    this.voxCache = null;
  }

  async load(url, { yaw = 0, height = 5, linear = false } = {}) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.yawGroup.clear();
    this.yawGroup.add(gltf.scene);
    this.materials = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.side = THREE.DoubleSide;
        if (m.map) m.userData.srcColorSpace = m.map.colorSpace;
        // Generated meshes often come out fully metallic, which renders black without an env map.
        if ('metalness' in m) { m.metalness = 0; m.roughness = Math.max(0.6, m.roughness ?? 1); }
        this.materials.push(m);
      }
    });
    this.groundRemoved = this.stripGround();
    this.loaded = true;
    this.setLinear(linear);
    this.setTransform({ yaw, height });
    this.applyGhost();
  }

  // Some generators (Hunyuan3D-2.1) turn the picture's ground shadow into a thin plate under
  // the model, which skews height, camera matching and every comparison. Cut it off:
  // triangles in the bottom 3 % that lie outside the footprint of what stands on the plate,
  // but only when that bottom band is far wider than the footprint (a real plate).
  stripGround() {
    this.yawGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.yawGroup);
    const H = box.max.y - box.min.y;
    if (!(H > 0)) return 0;
    const band = box.min.y + H * 0.03, above = box.min.y + H * 0.09;
    const meshes = [];
    this.yawGroup.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const foot = new THREE.Box2(), plate = new THREE.Box2();
    const tri = (g, t) => (g.index ? [g.index.getX(t * 3), g.index.getX(t * 3 + 1), g.index.getX(t * 3 + 2)] : [t * 3, t * 3 + 1, t * 3 + 2]);
    const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const load = (o, t) => {
      const pos = o.geometry.attributes.position, [i0, i1, i2] = tri(o.geometry, t);
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
    };
    for (const o of meshes) for (let t = 0; t < triCount(o.geometry); t++) {
      load(o, t);
      const top = Math.max(a.y, b.y, c.y), mid = (a.y + b.y + c.y) / 3;
      if (top <= band) plate.expandByPoint(new THREE.Vector2((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3));
      else if (mid <= above) for (const p of [a, b, c]) foot.expandByPoint(new THREE.Vector2(p.x, p.z));
    }
    const areaOf = (r) => (r.isEmpty() ? 0 : (r.max.x - r.min.x) * (r.max.y - r.min.y));
    if (foot.isEmpty() || areaOf(plate) < 4 * areaOf(foot)) return 0;
    foot.expandByScalar(H * 0.03);
    let removed = 0;
    for (const o of meshes) {
      const g = o.geometry, keep = [];
      if (g.groups.length > 1) continue; // multi-material ranges: leave as is
      for (let t = 0; t < triCount(g); t++) {
        load(o, t);
        const inPlate = Math.max(a.y, b.y, c.y) <= band && !foot.containsPoint(new THREE.Vector2((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3));
        if (inPlate) removed++; else keep.push(...tri(g, t));
      }
      if (keep.length !== triCount(g) * 3) o.geometry = compactGeometry(g, keep);
    }
    return removed;
  }

  // Some generators (TRELLIS) store linear values in the sRGB base-color texture,
  // which makes everything look far too dark. `linear` reinterprets the texture.
  setLinear(linear) {
    this.linear = !!linear;
    for (const m of this.materials) {
      if (!m.map) continue;
      m.map.colorSpace = this.linear ? THREE.LinearSRGBColorSpace : (m.userData.srcColorSpace || THREE.SRGBColorSpace);
      m.map.needsUpdate = true;
      m.needsUpdate = true;
    }
    this.voxCache = null;
  }

  unload() {
    this.yawGroup.clear();
    this.loaded = false;
    this.root.visible = false;
    this.voxCache = null;
  }

  // Normalize: rotate by yaw, scale to `height` studs, stand on y=0, center x/z.
  setTransform({ yaw = 0, height = 5 }) {
    if (!this.loaded) return;
    this.yaw = yaw; this.height = height;
    this.root.scale.setScalar(1);
    this.root.position.set(0, 0, 0);
    this.yawGroup.rotation.set(0, (yaw * Math.PI) / 180, 0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.yawGroup);
    const s = height / Math.max(1e-6, box.max.y - box.min.y);
    this.root.scale.setScalar(s);
    const c = box.getCenter(new THREE.Vector3());
    this.root.position.set(-c.x * s, -box.min.y * s, -c.z * s);
    this.root.updateMatrixWorld(true);
    this.voxCache = null;
  }

  applyGhost() {
    this.root.visible = this.loaded && this.ghost;
    this.setOpaque(false);
  }

  setOpaque(opaque) {
    for (const m of this.materials) {
      m.transparent = !opaque;
      m.opacity = opaque ? 1 : this.opacity;
      m.depthWrite = opaque;
      m.needsUpdate = true;
    }
  }

  bounds() {
    return new THREE.Box3().setFromObject(this.yawGroup);
  }

  info() {
    const b = this.bounds();
    return {
      loaded: this.loaded, yaw: this.yaw, height: this.height,
      min: b.min.toArray().map(r2), max: b.max.toArray().map(r2),
      size: b.getSize(new THREE.Vector3()).toArray().map(r2),
    };
  }

  // ---------------------------------------------------------------------------
  // Voxelization: area-weighted surface sampling (with texture colors) + interior flood fill.
  // ---------------------------------------------------------------------------
  voxelize(res = 32) {
    if (this.voxCache?.res === res) return this.voxCache;
    this.root.updateMatrixWorld(true);
    const box = this.bounds();
    const size = box.getSize(new THREE.Vector3());
    const vs = Math.max(size.x, size.y, size.z) / res;
    // Fit the grid exactly to the bounds (near-cubic voxels, per-axis size).
    const nx = Math.max(1, Math.round(size.x / vs)), ny = Math.max(1, Math.round(size.y / vs)), nz = Math.max(1, Math.round(size.z / vs));
    const vx = size.x / nx || vs, vy = size.y / ny || vs, vz = size.z / nz || vs;
    const N = nx * ny * nz;
    const count = new Float32Array(N), rs = new Float32Array(N), gs = new Float32Array(N), bs = new Float32Array(N);
    const idx = (x, y, z) => x + nx * (y + ny * z);

    // gather triangles
    const tris = [];
    let total = 0, signedVol = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    this.yawGroup.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv, col = g.attributes.color;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const tex = textureSampler(mat?.map, this.linear);
      const base = mat?.color ? [mat.color.r, mat.color.g, mat.color.b] : [1, 1, 1];
      const index = g.index ? g.index.array : null;
      const triCount = index ? index.length / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index[t * 3] : t * 3, i1 = index ? index[t * 3 + 1] : t * 3 + 1, i2 = index ? index[t * 3 + 2] : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
        const cr = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        const area = cr.length() / 2;
        if (area <= 0) continue;
        total += area;
        signedVol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
        tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), n: cr.normalize(), cum: total, uv, col, tex, base, i: [i0, i1, i2] });
      }
    });
    if (!tris.length) throw new Error('Mesh has no triangles');

    // Enough samples that every voxel face gets several hits.
    const samples = Math.min(600000, Math.max(120000, Math.round((total / (vs * vs)) * 12)));
    const p = new THREE.Vector3();
    // Sample half a voxel INSIDE the surface so boundary voxels count only when
    // mostly filled (otherwise the result is a voxel too fat on every side).
    const inset = -0.5 * vs * (signedVol >= 0 ? 1 : -1);
    const clampI = (v, n) => Math.max(0, Math.min(n - 1, v));
    for (let s = 0; s < samples; s++) {
      const r = Math.random() * total;
      let lo = 0, hi = tris.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tris[mid].cum < r) lo = mid + 1; else hi = mid; }
      const T = tris[lo];
      let u = Math.random(), v = Math.random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const w = 1 - u - v;
      p.set(0, 0, 0).addScaledVector(T.a, w).addScaledVector(T.b, u).addScaledVector(T.c, v).addScaledVector(T.n, inset);
      const x = clampI(Math.floor((p.x - box.min.x) / vx), nx);
      const y = clampI(Math.floor((p.y - box.min.y) / vy), ny);
      const z = clampI(Math.floor((p.z - box.min.z) / vz), nz);
      let rgb;
      if (T.tex && T.uv) {
        const tu = T.uv.getX(T.i[0]) * w + T.uv.getX(T.i[1]) * u + T.uv.getX(T.i[2]) * v;
        const tv = T.uv.getY(T.i[0]) * w + T.uv.getY(T.i[1]) * u + T.uv.getY(T.i[2]) * v;
        rgb = T.tex(tu, tv);
      } else if (T.col) {
        rgb = [T.col.getX(T.i[0]) * w + T.col.getX(T.i[1]) * u + T.col.getX(T.i[2]) * v,
          T.col.getY(T.i[0]) * w + T.col.getY(T.i[1]) * u + T.col.getY(T.i[2]) * v,
          T.col.getZ(T.i[0]) * w + T.col.getZ(T.i[1]) * u + T.col.getZ(T.i[2]) * v].map((q) => q * 255);
      } else rgb = [255, 255, 255];
      const k = idx(x, y, z);
      count[k]++;
      rs[k] += rgb[0] * T.base[0]; gs[k] += rgb[1] * T.base[1]; bs[k] += rgb[2] * T.base[2];
    }

    // 0 = empty, 1 = surface, 2 = interior
    const state = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (count[k] > 0) state[k] = 1;
    // flood fill outside through empty voxels (from the grid border)
    const outside = new Uint8Array(N);
    const stack = [];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (x && y && z && x < nx - 1 && y < ny - 1 && z < nz - 1) continue;
      const k = idx(x, y, z);
      if (!state[k] && !outside[k]) { outside[k] = 1; stack.push(k); }
    }
    while (stack.length) {
      const k = stack.pop();
      const x = k % nx, y = Math.floor(k / nx) % ny, z = Math.floor(k / (nx * ny));
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
        const j = idx(X, Y, Z);
        if (!state[j] && !outside[j]) { outside[j] = 1; stack.push(j); }
      }
    }
    for (let k = 0; k < N; k++) if (!state[k] && !outside[k]) state[k] = 2;

    const colors = new Array(N);
    for (let k = 0; k < N; k++) if (state[k] === 1) colors[k] = [rs[k] / count[k], gs[k] / count[k], bs[k] / count[k]];
    this.voxCache = { res, vs, v: [vx, vy, vz], nx, ny, nz, origin: box.min.clone(), state, colors, idx };
    return this.voxCache;
  }

  // k-means palette over surface voxel colors; returns labels (-1 = interior wildcard)
  quantize(vox, k = 8) {
    const pts = [];
    for (let i = 0; i < vox.state.length; i++) if (vox.state[i] === 1) pts.push(i);
    const cols = pts.map((i) => vox.colors[i]);
    k = Math.max(1, Math.min(k, cols.length));
    const dist = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
    // farthest-point init (deterministic)
    const mean = [0, 1, 2].map((j) => cols.reduce((s, c) => s + c[j], 0) / cols.length);
    const cent = [cols.reduce((best, c) => (dist(c, mean) < dist(best, mean) ? c : best), cols[0]).slice()];
    while (cent.length < k) {
      let far = cols[0], fd = -1;
      for (const c of cols) { const d = Math.min(...cent.map((m) => dist(c, m))); if (d > fd) { fd = d; far = c; } }
      cent.push(far.slice());
    }
    const lab = new Int16Array(cols.length);
    for (let it = 0; it < 12; it++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      cols.forEach((c, i) => {
        let bi = 0, bd = Infinity;
        cent.forEach((m, j) => { const d = dist(c, m); if (d < bd) { bd = d; bi = j; } });
        lab[i] = bi; const s = sum[bi]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++;
      });
      sum.forEach((s, j) => { if (s[3]) cent[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }
    const labels = new Int16Array(vox.state.length).fill(-2); // -2 empty
    pts.forEach((p, i) => (labels[p] = lab[i]));
    for (let i = 0; i < labels.length; i++) if (vox.state[i] === 2) labels[i] = -1;
    return { labels, palette: cent.map(hex) };
  }

  // Cross-section measurements along an axis, as text for Claude.
  slices({ axis = 'y', count = 16, res = 48 } = {}) {
    const vox = this.voxelize(res);
    const { labels, palette } = this.quantize(vox, 8);
    const { nx, ny, nz, vs, v: vsz, origin, idx } = vox;
    const A = { x: 0, y: 1, z: 2 }[axis];
    const dims = [nx, ny, nz];
    const [U, V] = [0, 1, 2].filter((d) => d !== A);
    const names = ['x', 'y', 'z'];
    const o = origin.toArray();
    const slabs = Math.min(count, dims[A]);
    const lines = [`Cross-sections of the 3D scan along ${axis} (${slabs} slabs, voxel ${r2(vs)} studs). Each blob: ${names[U]} range, ${names[V]} range, main color.`];
    for (let s = 0; s < slabs; s++) {
      const a0 = Math.floor((s * dims[A]) / slabs), a1 = Math.floor(((s + 1) * dims[A]) / slabs);
      const W = dims[U], H = dims[V];
      const occ = new Int16Array(W * H).fill(-2);
      const tally = new Map();
      for (let a = a0; a < a1; a++) for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
        const c = [0, 0, 0]; c[A] = a; c[U] = u; c[V] = v;
        const l = labels[idx(c[0], c[1], c[2])];
        if (l === -2) continue;
        if (occ[u + W * v] < 0 || l >= 0) occ[u + W * v] = l;
      }
      // connected components
      const seen = new Uint8Array(W * H);
      const blobs = [];
      for (let start = 0; start < W * H; start++) {
        if (occ[start] === -2 || seen[start]) continue;
        let minU = W, maxU = 0, minV = H, maxV = 0, n = 0;
        tally.clear();
        const st = [start]; seen[start] = 1;
        while (st.length) {
          const k = st.pop(); const u = k % W, v = Math.floor(k / W); n++;
          minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
          if (occ[k] >= 0) tally.set(occ[k], (tally.get(occ[k]) || 0) + 1);
          for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const U2 = u + du, V2 = v + dv;
            if (U2 < 0 || V2 < 0 || U2 >= W || V2 >= H) continue;
            const j = U2 + W * V2;
            if (occ[j] !== -2 && !seen[j]) { seen[j] = 1; st.push(j); }
          }
        }
        const main = [...tally.entries()].sort((p, q) => q[1] - p[1])[0];
        blobs.push({ n, txt: `${names[U]} ${r2(o[U] + minU * vsz[U])}..${r2(o[U] + (maxU + 1) * vsz[U])}, ${names[V]} ${r2(o[V] + minV * vsz[V])}..${r2(o[V] + (maxV + 1) * vsz[V])}${main ? ', ' + palette[main[0]] : ''}` });
      }
      blobs.sort((p, q) => q.n - p.n);
      const range = `${axis} ${r2(o[A] + a0 * vsz[A])}–${r2(o[A] + a1 * vsz[A])}`;
      lines.push(`${range}: ${blobs.length ? blobs.slice(0, 8).map((b) => `[${b.txt}]`).join(' ') : '(empty)'}${blobs.length > 8 ? ` +${blobs.length - 8} small` : ''}`);
    }
    lines.push(`Scan palette: ${palette.join(' ')}`);
    return lines.join('\n');
  }

  // Greedy box merging of the voxel grid into colored cubes.
  blockify({ res = 20, colors = 8 } = {}) {
    const vox = this.voxelize(res);
    const { labels, palette } = this.quantize(vox, colors);
    const { nx, ny, nz, vs, v: [vx, vy, vz], origin, idx } = vox;
    const used = new Uint8Array(labels.length);
    const ok = (x, y, z, L) => {
      if (x >= nx || y >= ny || z >= nz) return false;
      const k = idx(x, y, z);
      return !used[k] && (labels[k] === L || labels[k] === -1);
    };
    const parts = [];
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const k = idx(x, y, z);
      const L = labels[k];
      if (used[k] || L < 0) continue;
      let x2 = x; while (ok(x2 + 1, y, z, L)) x2++;
      let z2 = z;
      zl: while (true) { for (let xi = x; xi <= x2; xi++) if (!ok(xi, y, z2 + 1, L)) break zl; z2++; }
      let y2 = y;
      yl: while (true) { for (let zi = z; zi <= z2; zi++) for (let xi = x; xi <= x2; xi++) if (!ok(xi, y2 + 1, zi, L)) break yl; y2++; }
      for (let yi = y; yi <= y2; yi++) for (let zi = z; zi <= z2; zi++) for (let xi = x; xi <= x2; xi++) used[idx(xi, yi, zi)] = 1;
      const size = [(x2 - x + 1) * vx, (y2 - y + 1) * vy, (z2 - z + 1) * vz];
      const pos = [origin.x + (x + (x2 - x + 1) / 2) * vx, origin.y + (y + (y2 - y + 1) / 2) * vy, origin.z + (z + (z2 - z + 1) / 2) * vz];
      parts.push({ position: pos.map((n) => Math.round(n * 1000) / 1000), size: size.map((n) => Math.round(n * 1000) / 1000), color: palette[L] });
    }
    return { parts, palette, voxel: r2(vs), grid: [nx, ny, nz] };
  }

  // ---------------------------------------------------------------------------
  // Tree mode: split the voxelized scan into wood (trunk, branches, roots) and canopy,
  // then measure each piece so it can be rebuilt as clean stud-style boxes:
  // trunk = stacked boxes along its axis, branches = rotated boxes along line segments,
  // canopy = a few box-shaped clusters with their colors.
  // ---------------------------------------------------------------------------
  treeSkeleton({ res = 48, clusters = 0 } = {}) {
    const vox = this.voxelize(res);
    const { nx, ny, nz, v: [vx, vy, vz], origin, colors, idx } = vox;
    const N = vox.state.length;
    // Some generators (Hunyuan3D-2.1) add a thin ground plate from the picture's shadow:
    // drop bottom layers that are far wider than the trunk just above them.
    const state = vox.state.slice();
    const area = (y) => { let n = 0; for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) if (state[idx(x, y, z)]) n++; return n; };
    let ground = 0;
    while (ground < Math.max(1, Math.round(ny * 0.06))) {
      const above = [1, 2, 3, 4].map((d) => area(Math.min(ny - 1, ground + d))).sort((p, q2) => p - q2)[1];
      if (area(ground) <= 3 * Math.max(1, above)) break;
      ground++;
    }
    for (let y = 0; y < ground; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) state[idx(x, y, z)] = 0;
    const X = (k) => k % nx, Y = (k) => Math.floor(k / nx) % ny, Z = (k) => Math.floor(k / (nx * ny));
    const pos = (k) => [origin.x + (X(k) + 0.5) * vx, origin.y + (Y(k) + 0.5) * vy, origin.z + (Z(k) + 0.5) * vz];
    const height = ny * vy;

    // 1. Wood vs leaf colors. Wood = what the bottom of the tree is made of; leaves = the top.
    // Works for any palette (brown/green, dark-green trunk + purple leaves, blue leaves…).
    const surf = [];
    for (let k = 0; k < N; k++) if (state[k] === 1) surf.push(k);
    const median = (list) => [0, 1, 2].map((j) => { const a = list.map((c) => c[j]).sort((p, q) => p - q); return a[a.length >> 1] ?? 0; });
    const bottomY = Math.max(1, Math.round(ny * 0.12));
    const woodRef = median(surf.filter((k) => Y(k) < ground + bottomY).map((k) => colors[k]));
    const leafRef = median(surf.filter((k) => Y(k) >= ny * 0.6).map((k) => colors[k]));
    const L = (c) => rgbLab(c);
    const woodLab = L(woodRef), leafLab = L(leafRef);
    const colorSplit = labDist(woodLab, leafLab) > 15;
    // label: 0 empty, 1 wood, 2 leaf
    const label = new Uint8Array(N);
    const { labels: q, palette } = this.quantize(vox, 10);
    const palWood = palette.map((h) => { const l = L(hexRgb(h)); return labDist(l, woodLab) < labDist(l, leafLab); });
    // Geometric fallback for one-colored trees: layers much wider than the base are canopy.
    const layerArea = new Array(ny).fill(0);
    for (let k = 0; k < N; k++) if (state[k]) layerArea[Y(k)]++;
    const baseArea = Math.max(1, median(layerArea.slice(ground, ground + bottomY).map((a) => [a, a, a]))[0]);
    for (const k of surf) label[k] = colorSplit ? (palWood[q[k]] ? 1 : 2) : (layerArea[Y(k)] > baseArea * 2.5 ? 2 : 1);

    // 2. Interior voxels take the label of the nearest surface voxel (multi-source BFS).
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const nb = (k, fn) => {
      const x = X(k), y = Y(k), z = Z(k);
      for (const [dx, dy, dz] of N6) {
        const a = x + dx, b = y + dy, c = z + dz;
        if (a >= 0 && b >= 0 && c >= 0 && a < nx && b < ny && c < nz) fn(idx(a, b, c));
      }
    };
    let front = surf.slice();
    while (front.length) {
      const next = [];
      for (const k of front) nb(k, (j) => { if (state[j] === 2 && !label[j]) { label[j] = label[k]; next.push(j); } });
      front = next;
    }

    // 3. Denoise: tiny wood specks inside the canopy (shading) become leaf, and vice versa.
    const components = (want) => {
      const seen = new Uint8Array(N), out = [];
      for (let s = 0; s < N; s++) {
        if (!want(s) || seen[s]) continue;
        const comp = [s]; seen[s] = 1;
        for (let i = 0; i < comp.length; i++) {
          const k = comp[i], x = X(k), y = Y(k), z = Z(k);
          for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy && !dz) continue;
            const a = x + dx, b = y + dy, c = z + dz;
            if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
            const j = idx(a, b, c);
            if (!seen[j] && want(j)) { seen[j] = 1; comp.push(j); }
          }
        }
        out.push(comp);
      }
      return out;
    };
    const tiny = Math.max(3, Math.round((res / 32) ** 3 * 3));
    for (const comp of components((k) => label[k] === 1)) if (comp.length < tiny) comp.forEach((k) => (label[k] = 2));
    for (const comp of components((k) => label[k] === 2)) if (comp.length < tiny) comp.forEach((k) => (label[k] = 1));

    // 4. Trunk: follow the wood upward layer by layer, keeping the 2D blob that overlaps
    // the one below. It ends where it forks into similar-sized blobs or thins out a lot.
    const layerBox = (l) => {
      let x0 = nx, x1 = -1, z0 = nz, z1 = -1;
      for (const s of l.cells) { const x = s % nx, z = Math.floor(s / nx); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return { x0, x1, z0, z1 };
    };
    const inTrunk = new Uint8Array(N);
    const layers = [];
    let prev = null;
    for (let y = 0; y < ny; y++) {
      const W = nx, seen = new Uint8Array(nx * nz), blobs = [];
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        const s = x + W * z;
        if (seen[s] || label[idx(x, y, z)] !== 1) continue;
        const cells = [s]; seen[s] = 1;
        for (let i = 0; i < cells.length; i++) {
          const cx = cells[i] % W, cz = Math.floor(cells[i] / W);
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const a = cx + dx, c = cz + dz;
            if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
            const j = a + W * c;
            if (!seen[j] && label[idx(a, y, c)] === 1) { seen[j] = 1; cells.push(j); }
          }
        }
        blobs.push(new Set(cells));
      }
      if (!blobs.length) { if (prev) break; continue; }
      let pick;
      if (!prev) {
        // start: the biggest wood blob near the middle of the footprint
        const cxz = (b) => { let sx = 0, sz = 0; for (const s of b) { sx += s % W; sz += Math.floor(s / W); } return [sx / b.size, sz / b.size]; };
        pick = blobs.map((b) => { const [a, c] = cxz(b); return { b, score: b.size / (1 + Math.hypot(a - nx / 2, c - nz / 2) / 4) }; }).sort((p, q2) => q2.score - p.score)[0].b;
      } else {
        const over = blobs.map((b) => { let n = 0; for (const s of b) if (prev.has(s)) n++; return { b, n }; }).filter((o) => o.n > 0).sort((p, q2) => q2.b.size - p.b.size);
        if (!over.length) break;
        const typical = median(layers.map((l) => [l.cells.size, 0, 0]))[0];
        if (over.length > 1 && over[1].b.size >= over[0].b.size * 0.45) break; // fork
        if (over[0].b.size < typical * 0.25) break; // thinned out into a branch
        pick = over[0].b;
        // Where branches leave the trunk they share its 2D blob: keep only the trunk's
        // usual footprint around the axis, the rest stays wood for the branch fits.
        if (layers.length >= 2) {
          const md = (a) => a.sort((p, q2) => p - q2)[a.length >> 1];
          const bx = layers.map((l) => layerBox(l));
          const twx = md(bx.map((b) => b.x1 - b.x0 + 1)), twz = md(bx.map((b) => b.z1 - b.z0 + 1));
          let cx = 0, cz = 0; for (const s of prev) { cx += s % W; cz += Math.floor(s / W); }
          cx /= prev.size; cz /= prev.size;
          pick = new Set([...pick].filter((s) => Math.abs((s % W) - cx) <= twx / 2 + 0.5 && Math.abs(Math.floor(s / W) - cz) <= twz / 2 + 0.5));
          if (!pick.size) break;
        }
      }
      layers.push({ y, cells: pick });
      for (const s of pick) inTrunk[idx(s % W, y, Math.floor(s / W))] = 1;
      prev = pick;
    }
    const axis = layers.map((l) => {
      const b = layerBox(l);
      let sx = 0, sz = 0; for (const s of l.cells) { sx += s % nx; sz += Math.floor(s / nx); }
      return {
        y: r2(origin.y + (l.y + 0.5) * vy),
        center: [r2(origin.x + (sx / l.cells.size + 0.5) * vx), r2(origin.z + (sz / l.cells.size + 0.5) * vz)],
        width: r2((b.x1 - b.x0 + 1) * vx), depth: r2((b.z1 - b.z0 + 1) * vz), b, ly: l.y,
      };
    });
    // Stacked sections: consecutive layers with about the same footprint become one box.
    // The flared base (root collar) usually becomes its own section.
    const sections = [];
    for (const a of axis) {
      const s = sections.at(-1);
      const same = s && Math.abs(a.b.x0 - s.b.x0) <= 1 && Math.abs(a.b.x1 - s.b.x1) <= 1 && Math.abs(a.b.z0 - s.b.z0) <= 1 && Math.abs(a.b.z1 - s.b.z1) <= 1;
      if (same) { s.y1 = a.ly; s.xs.push(a.b.x0, a.b.x1); s.zs.push(a.b.z0, a.b.z1); }
      else sections.push({ y0: a.ly, y1: a.ly, b: a.b, xs: [a.b.x0, a.b.x1], zs: [a.b.z0, a.b.z1] });
    }
    // Merge 1-layer slivers into the section below (voxel noise, not real steps).
    for (let i = sections.length - 1; i > 0; i--) if (sections[i].y1 === sections[i].y0) {
      const p = sections[i - 1]; p.y1 = sections[i].y1; sections.splice(i, 1);
    }
    const trunk = sections.map((s) => {
      // median edges are steadier than min/max over the section's layers
      const xs0 = [], xs1 = [], zs0 = [], zs1 = [];
      for (let i = 0; i < s.xs.length; i += 2) { xs0.push(s.xs[i]); xs1.push(s.xs[i + 1]); zs0.push(s.zs[i]); zs1.push(s.zs[i + 1]); }
      const md = (a) => a.sort((p, q2) => p - q2)[a.length >> 1];
      const x0 = origin.x + md(xs0) * vx, x1 = origin.x + (md(xs1) + 1) * vx;
      const z0 = origin.z + md(zs0) * vz, z1 = origin.z + (md(zs1) + 1) * vz;
      const y0 = origin.y + s.y0 * vy, y1 = origin.y + (s.y1 + 1) * vy;
      return { min: [r2(x0), r2(y0), r2(z0)], max: [r2(x1), r2(y1), r2(z1)], size: [r2(x1 - x0), r2(y1 - y0), r2(z1 - z0)], center: [r2((x0 + x1) / 2), r2((y0 + y1) / 2), r2((z0 + z1) / 2)] };
    });
    const trunkTop = trunk.length ? trunk.at(-1).max[1] : origin.y;
    const trunkAt = (y) => {
      const a = axis.reduce((best, l) => (Math.abs(l.y - y) < Math.abs(best.y - y) ? l : best), axis[0] || { center: [0, 0], y: 0 });
      return a.center;
    };

    // 5. Branches (and roots): the remaining wood, as straight segments (PCA line fits;
    // bent pieces are split in two until each piece is straight).
    const segs = [];
    const fit = (keys, depth = 0) => {
      if (keys.length < tiny) return;
      const P = keys.map(pos);
      const c = [0, 1, 2].map((j) => P.reduce((s, p) => s + p[j], 0) / P.length);
      const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const p of P) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (p[i] - c[i]) * (p[j] - c[j]);
      let d = [0.3, 1, 0.2];
      for (let it = 0; it < 40; it++) {
        const n = [0, 1, 2].map((i) => cov[i][0] * d[0] + cov[i][1] * d[1] + cov[i][2] * d[2]);
        const len = Math.hypot(...n) || 1; d = n.map((v) => v / len);
      }
      const t = P.map((p) => (p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1] + (p[2] - c[2]) * d[2]);
      const perp = P.map((p, i) => Math.hypot(p[0] - c[0] - t[i] * d[0], p[1] - c[1] - t[i] * d[1], p[2] - c[2] - t[i] * d[2]));
      let tmin = Infinity, tmax = -Infinity;
      for (const v of t) { if (v < tmin) tmin = v; if (v > tmax) tmax = v; }
      const vmean = (vx + vy + vz) / 3;
      const length = tmax - tmin + vmean;
      const thick = Math.max(vmean, Math.sqrt((keys.length * vx * vy * vz) / length));
      const rms = Math.sqrt(perp.reduce((s, v) => s + v * v, 0) / perp.length);
      // Bent or Y-shaped: split at the median along the axis and fit both halves.
      if (depth < 3 && length > thick * 3 && rms > Math.max(thick * 0.6, vmean * 1.2)) {
        const mid = [...t].sort((p, q2) => p - q2)[t.length >> 1];
        fit(keys.filter((_, i) => t[i] <= mid), depth + 1);
        fit(keys.filter((_, i) => t[i] > mid), depth + 1);
        return;
      }
      let a = c.map((v, j) => v + d[j] * (tmin - vmean / 2)), b = c.map((v, j) => v + d[j] * (tmax + vmean / 2));
      // start = the end attached to the trunk (closer to the trunk axis), else the lower end
      const dist = (p) => { const [tx, tz] = trunkAt(p[1]); return Math.hypot(p[0] - tx, p[2] - tz); };
      if (dist(b) < dist(a) - vmean || (Math.abs(dist(b) - dist(a)) <= vmean && b[1] < a[1])) [a, b] = [b, a];
      segs.push({ a, b, thick, n: keys.length });
    };
    for (const comp of components((k) => label[k] === 1 && !inTrunk[k])) fit(comp);
    const up = new THREE.Vector3(0, 1, 0);
    const branches = segs.sort((p, q2) => q2.n - p.n).map((s) => {
      const dir = new THREE.Vector3(...s.b).sub(new THREE.Vector3(...s.a));
      const length = dir.length(); dir.normalize();
      const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir), 'XYZ');
      const tilt = Math.round((Math.acos(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI);
      const kind = Math.max(s.a[1], s.b[1]) < origin.y + height * 0.15 ? 'root' : 'branch';
      return {
        kind, start: s.a.map(r2), end: s.b.map(r2), length: r2(length), thickness: r2(s.thick), tilt_deg: tilt,
        box: { position: s.a.map((v, j) => r2((v + s.b[j]) / 2)), size: [r2(s.thick), r2(length), r2(s.thick)], rotation: [e.x, e.y, e.z].map((r) => Math.round((r * 180) / Math.PI)) },
      };
    }).slice(0, 24);

    // 6. Canopy: leaf voxels split into box-like clusters (k-means on positions; k = the
    // smallest count whose clusters fill their boxes well, unless `clusters` is given).
    const leaf = [];
    for (let k = 0; k < N; k++) if (label[k] === 2) leaf.push(k);
    const LP = leaf.map(pos);
    const kmeans = (k) => {
      const dist = (p, q2) => (p[0] - q2[0]) ** 2 + ((p[1] - q2[1]) * 1.3) ** 2 + (p[2] - q2[2]) ** 2;
      const cent = [LP[0]];
      // farthest-point init (deterministic), seeded from the highest point
      cent[0] = LP.reduce((b, p) => (p[1] > b[1] ? p : b), LP[0]);
      const dmin = LP.map((p) => dist(p, cent[0]));
      while (cent.length < k) {
        let fi = 0; for (let i = 1; i < LP.length; i++) if (dmin[i] > dmin[fi]) fi = i;
        cent.push(LP[fi]); for (let i = 0; i < LP.length; i++) dmin[i] = Math.min(dmin[i], dist(LP[i], LP[fi]));
      }
      const lab = new Int16Array(LP.length);
      for (let it = 0; it < 15; it++) {
        const sum = cent.map(() => [0, 0, 0, 0]);
        LP.forEach((p, i) => {
          let bi = 0, bd = Infinity;
          cent.forEach((m, j) => { const d = dist(p, m); if (d < bd) { bd = d; bi = j; } });
          lab[i] = bi; const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
        });
        sum.forEach((s, j) => { if (s[3]) cent[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
      }
      // box per cluster: 5–95 % extents (ignores stray voxels) + fill ratio
      const groups = cent.map(() => []);
      lab.forEach((j, i) => groups[j].push(i));
      return groups.filter((g) => g.length).map((g) => {
        const lo = [], hi = [];
        for (let j = 0; j < 3; j++) {
          const a = g.map((i) => LP[i][j]).sort((p, q2) => p - q2);
          const half = [vx, vy, vz][j] / 2;
          lo.push(a[Math.floor(a.length * 0.05)] - half); hi.push(a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] + half);
        }
        const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
        return { g, lo, hi, fill: Math.min(1, (g.length * vx * vy * vz) / Math.max(1e-6, vol)) };
      });
    };
    let canopyFit = [];
    if (LP.length) {
      if (clusters > 0) canopyFit = kmeans(Math.min(16, clusters));
      else {
        // A blobby scan of 3 stud blocks fills one box ~85 % but three boxes ~100 %:
        // take the best fill, with a small cost per extra cluster.
        let best = null;
        for (let k = 1; k <= 8; k++) {
          const f = kmeans(k);
          const score = f.reduce((s, c) => s + c.fill * c.g.length, 0) / LP.length - 0.015 * k;
          if (!best || score > best.score) best = { f, score };
        }
        canopyFit = best.f;
      }
    }
    const canopy = canopyFit.map((c) => {
      const surfCols = c.g.map((i) => leaf[i]).filter((k) => state[k] === 1).map((k) => colors[k]);
      const main = median(surfCols.length ? surfCols : [leafRef]);
      return {
        min: c.lo.map(r2), max: c.hi.map(r2), size: c.lo.map((v, j) => r2(c.hi[j] - v)), center: c.lo.map((v, j) => r2((v + c.hi[j]) / 2)),
        voxels: c.g.length, fill: r2(c.fill), color: hex(main), _main: L(main), _keys: c.g.map((i) => leaf[i]),
      };
    }).sort((p, q2) => p.min[1] - q2.min[1] || q2.voxels - p.voxels);

    // 7. Accents inside the canopy (flowers, fruit, lighter leaf plates): surface voxels whose
    // color is far from their cluster's main color, grouped into blobs.
    const accentOf = new Uint8Array(N);
    // Same hue but darker = shading, not an accent: look for a hue shift or a lighter color.
    const isAccent = (c, m) => Math.hypot(c[1] - m[1], c[2] - m[2]) > 25 || c[0] - m[0] > 20;
    for (const c of canopy) for (const k of c._keys) if (state[k] === 1 && isAccent(L(colors[k]), c._main)) accentOf[k] = 1;
    const accents = components((k) => accentOf[k] === 1).filter((comp) => comp.length >= tiny).map((comp) => {
      const P = comp.map(pos);
      const lo = [0, 1, 2].map((j) => Math.min(...P.map((p) => p[j])) - [vx, vy, vz][j] / 2);
      const hi = [0, 1, 2].map((j) => Math.max(...P.map((p) => p[j])) + [vx, vy, vz][j] / 2);
      return { min: lo.map(r2), max: hi.map(r2), center: lo.map((v, j) => r2((v + hi[j]) / 2)), size: lo.map((v, j) => r2(hi[j] - v)), color: hex(median(comp.map((k) => colors[k]))), voxels: comp.length };
    }).sort((p, q2) => q2.voxels - p.voxels).slice(0, 16);
    for (const c of canopy) { delete c._main; delete c._keys; }

    const woodCol = hex(median(surf.filter((k) => label[k] === 1).map((k) => colors[k])));
    return {
      voxel: r2(vox.vs), grid: [nx, ny, nz], height: r2(height),
      ground: r2(ground * vy), split: colorSplit ? 'color' : 'shape', wood_color: woodCol, leaf_color: hex(leafRef),
      trunk_top: r2(trunkTop),
      axis: axis.filter((_, i) => axis.length <= 24 || i % Math.ceil(axis.length / 24) === 0).map((a) => ({ y: a.y, center: a.center, width: a.width, depth: a.depth })),
      trunk, branches, canopy, accents,
    };
  }
}

// A copy of `g` with only the vertices that `index` uses (bounding boxes count every
// vertex in the buffer, so cut triangles must take their vertices with them).
function compactGeometry(g, index) {
  const remap = new Map(), order = [];
  const newIndex = index.map((i) => { if (!remap.has(i)) { remap.set(i, order.length); order.push(i); } return remap.get(i); });
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const arr = new attr.array.constructor(order.length * attr.itemSize);
    order.forEach((src, dst) => { for (let k = 0; k < attr.itemSize; k++) arr[dst * attr.itemSize + k] = attr.getComponent(src, k); });
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize, attr.normalized));
  }
  out.setIndex(newIndex);
  if (g.groups.length) out.addGroup(0, newIndex.length, g.groups[0].materialIndex);
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// sRGB 0..255 → CIELAB (perceptual distances for wood/leaf/accent colors)
function rgbLab(c) {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Returns (u,v) → [r,g,b] 0..255 for a texture, or null.
const LIN2SRGB = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
});

function textureSampler(map, linear = false) {
  const img = map?.image;
  if (!img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, cv.width, cv.height).data;
  const W = cv.width, H = cv.height;
  // glTF uv has v=0 at the image top (texture.flipY = false).
  const flipped = !!map.flipY;
  return (u, v) => {
    u = u - Math.floor(u); v = v - Math.floor(v);
    const px = Math.min(W - 1, Math.floor(u * W));
    const py = Math.min(H - 1, Math.floor((flipped ? 1 - v : v) * H));
    const o = (px + py * W) * 4;
    return linear ? [LIN2SRGB[data[o]], LIN2SRGB[data[o + 1]], LIN2SRGB[data[o + 2]]] : [data[o], data[o + 1], data[o + 2]];
  };
}
