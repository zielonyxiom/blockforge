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
    this.loaded = true;
    this.setLinear(linear);
    this.setTransform({ yaw, height });
    this.applyGhost();
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
}

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
