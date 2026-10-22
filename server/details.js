// Detail library: small designed elements (2–12 parts each) that make a tree look alive
// instead of plain boxes. Each detail is built in its own frame (Y = the surface normal it
// sticks out of, origin = the surface point), then placed with position/normal/roll/size.
// Pieces only touch or sink into each other from one side (no crossings, no flush faces),
// and nothing is thinner than 0.18 studs.
import * as THREE from 'three';

const D = Math.PI / 180;
const r = (v) => Math.round(v * 1000) / 1000;
const MIN = 0.18; // thinnest allowed piece
const HANGING = new Set(['drip', 'ornament', 'lantern']);

export function shade(hex, f) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join('');
}
const box = (name, pos, size, rot = [0, 0, 0], color, extra = {}) => ({ name, pos, size: size.map((v) => Math.max(MIN, v)), rot, color, ...extra });

// kind → (s = size in studs, c = colors) → pieces in the local frame
export const DETAILS = {
  // pointed leaf on a short stem, curling outward; base darker, tip lighter
  leaf: (s, c) => {
    const g = c.color || '#4c8a2a', out = [box('Stem', [0, 0.12 * s, 0], [0.2, 0.3 * s, 0.2], [0, 0, 0], shade(g, 0.75))];
    const widths = [0.38, 0.58, 0.52, 0.34, 0.2], seg = 0.24 * s;
    let y = 0.24 * s, z = 0, tilt = 20;
    widths.forEach((w, i) => {
      out.push(box(`Leaf_${i + 1}`, [0, y + seg / 2 * Math.cos(tilt * D), z + seg / 2 * Math.sin(tilt * D)], [w * s, seg * 1.15, 0.2], [tilt, 0, 0], shade(g, 0.9 + i * 0.07)));
      y += seg * Math.cos(tilt * D); z += seg * Math.sin(tilt * D); tilt += 9;
    });
    return out;
  },
  // three small pointed leaves fanned on one stem (ivy, vines, bushes)
  sprig: (s, c) => {
    const g = c.color || '#2f5a26';
    const out = [box('Stem', [0, 0.15 * s, 0], [0.2, 0.32 * s, 0.2], [0, 0, 0], shade(g, 0.8))];
    [-38, 0, 38].forEach((a, i) => {
      const dir = new THREE.Vector3(Math.sin(a * D), Math.cos(a * D), 0);
      const p1 = dir.clone().multiplyScalar(0.42 * s).add(new THREE.Vector3(0, 0.28 * s, 0)), p2 = dir.clone().multiplyScalar(0.78 * s).add(new THREE.Vector3(0, 0.28 * s, 0));
      out.push(box(`Leaf_${i + 1}`, p1.toArray(), [0.42 * s, 0.42 * s, 0.2], [0, 0, -a], shade(g, 1 + 0.06 * i)));
      out.push(box(`Leaf_${i + 1}_Tip`, p2.toArray(), [0.22 * s, 0.3 * s, 0.2], [0, 0, -a + 45], shade(g, 1.12 + 0.06 * i)));
    });
    return out;
  },
  // rounded fruit: a wide core with a smaller slab above and below (stacked, touching), a
  // stem and a small leaf
  fruit: (s, c) => {
    const f = c.color || '#b3241b', L = c.leaf || '#5f8f24', st = c.stem || '#544034';
    return [
      box('Fruit_Top', [0, -0.16 * s, 0], [0.72 * s, 0.24 * s, 0.72 * s], [0, 0, 0], shade(f, 1.08)),
      box('Fruit', [0, -0.58 * s, 0], [s, 0.6 * s, s], [0, 0, 0], f),
      box('Fruit_Bottom', [0, -1.0 * s, 0], [0.72 * s, 0.24 * s, 0.72 * s], [0, 0, 0], shade(f, 0.9)),
      box('Stem', [0, 0.1 * s, 0], [0.2, 0.3 * s, 0.2], [0, 0, 8], st),
      box('Leaf', [0.24 * s, 0.14 * s, 0], [0.42 * s, 0.2, 0.26 * s], [0, 20, -22], L),
    ];
  },
  // flower: center + ring of petals tilted up, alternating shades
  flower: (s, c) => {
    const p = c.color || '#f1c232', m = c.center || '#6b3d16', n = c.petals || 6, out = [box('Center', [0, 0.16 * s, 0], [0.42 * s, 0.32 * s, 0.42 * s], [0, 0, 0], m)];
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i, d = new THREE.Vector3(Math.sin(a * D), 0, Math.cos(a * D));
      out.push(box(`Petal_${i + 1}`, d.clone().multiplyScalar(0.45 * s).add(new THREE.Vector3(0, 0.14 * s, 0)).toArray(), [0.3 * s, 0.2, 0.55 * s], [-15 * Math.cos(a * D), a, 15 * Math.sin(a * D)], shade(p, i % 2 ? 0.92 : 1.06)));
    }
    return out;
  },
  // crystal cluster: 3–4 shards (square shaft turned 45°, stepped point), leaning outward
  crystal: (s, c) => {
    const cols = c.colors || [c.color || '#7fc8ff'], out = [];
    const shards = [[0, 0, 1.0, 0], [0.32, 0.1, 0.7, 24], [-0.3, -0.08, 0.62, -22], [0.05, -0.32, 0.5, 18]];
    shards.forEach(([x, z, h, lean], i) => {
      const col = cols[i % cols.length], w = 0.36 * s * (0.6 + 0.4 * h), H = h * s;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean * D * (z >= 0 ? 1 : -1) * 0.5, 45 * D, lean * D * (x >= 0 ? -1 : 1), 'YXZ'));
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q), base = new THREE.Vector3(x * s, 0, z * s);
      const e = new THREE.Euler().setFromQuaternion(q, 'XYZ'), rot = [e.x / D, e.y / D, e.z / D];
      out.push(box(`Shard_${i + 1}`, base.clone().addScaledVector(up, H * 0.38).toArray(), [w, H * 0.76, w], rot, col));
      out.push(box(`Shard_${i + 1}_Point`, base.clone().addScaledVector(up, H * 0.8).toArray(), [w * 0.62, H * 0.2, w * 0.62], rot, shade(col, 1.18)));
      out.push(box(`Shard_${i + 1}_Tip`, base.clone().addScaledVector(up, H * 0.93).toArray(), [w * 0.3, H * 0.1, w * 0.3], rot, shade(col, 1.32)));
    });
    return out;
  },
  // studded plate stuck on a surface (poison spots, decorations): plate + 2×2 studs
  studded_plate: (s, c) => {
    const p = c.color || '#7fc63c', out = [box('Plate', [0, 0.1, 0], [s, 0.34, s], [0, 0, 0], p)];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.push(box('Stud', [x * 0.24 * s, 0.36, z * 0.24 * s], [0.26 * s, 0.2, 0.26 * s], [0, 0, 0], shade(p, 1.12)));
    return out;
  },
  // round ornament hanging down from the anchor: ball + cap
  ornament: (s, c) => [
    box('Cap', [0, -0.12 * s, 0], [0.34 * s, 0.24 * s, 0.34 * s], [0, 0, 0], c.cap || '#d9b54a'),
    box('Ball', [0, -0.68 * s, 0], [s, s, s], [0, 0, 0], c.color || '#d33b3b', { shape: 'sphere' }),
  ],
  // lantern: glowing core, top and bottom caps, a hook
  lantern: (s, c) => {
    const f = c.frame || '#3b2a1e';
    return [
      box('Hook', [0, -0.15 * s, 0], [0.2, 0.3 * s, 0.2], [0, 0, 0], f),
      box('Top', [0, -0.38 * s, 0], [0.72 * s, 0.2 * s, 0.72 * s], [0, 0, 0], f),
      box('Glow', [0, -0.78 * s, 0], [0.56 * s, 0.62 * s, 0.56 * s], [0, 0, 0], c.color || '#ffd35a', { material: 'neon' }),
      box('Bottom', [0, -1.18 * s, 0], [0.72 * s, 0.2 * s, 0.72 * s], [0, 0, 0], f),
    ];
  },
  // flat round spot (mushroom caps, dots): pixel disc = center + 4 arms, touching only
  spot: (s, c) => {
    const p = c.color || '#f4f1e8';
    return [
      box('Spot', [0, 0.1, 0], [0.56 * s, 0.24, 0.56 * s], [0, 0, 0], p),
      box('Spot_N', [0, 0.1, 0.39 * s], [0.36 * s, 0.22, 0.22 * s], [0, 0, 0], p),
      box('Spot_S', [0, 0.1, -0.39 * s], [0.36 * s, 0.22, 0.22 * s], [0, 0, 0], p),
      box('Spot_E', [0.39 * s, 0.1, 0], [0.22 * s, 0.22, 0.36 * s], [0, 0, 0], p),
      box('Spot_W', [-0.39 * s, 0.1, 0], [0.22 * s, 0.22, 0.36 * s], [0, 0, 0], p),
    ];
  },
  // drip / icicle hanging from an edge: 3 shrinking blocks
  drip: (s, c) => {
    const p = c.color || '#e8c547';
    return [
      box('Drip_1', [0, -0.2 * s, 0], [0.42 * s, 0.4 * s, 0.42 * s], [0, 0, 0], p),
      box('Drip_2', [0, -0.55 * s, 0], [0.3 * s, 0.34 * s, 0.3 * s], [0, 12, 0], shade(p, 1.06)),
      box('Drip_3', [0, -0.82 * s, 0], [0.2, 0.24 * s, 0.2], [0, 24, 0], shade(p, 1.12)),
    ];
  },
  // 5-point star (tree tops): center + 5 points in the plane facing +Z
  star: (s, c) => {
    const p = c.color || '#ffd447', out = [box('Star', [0, 0, 0], [0.42 * s, 0.42 * s, 0.26 * s], [0, 0, 45], p, { material: c.material || 'neon' })];
    for (let i = 0; i < 5; i++) {
      const a = 72 * i, d = new THREE.Vector3(Math.sin(a * D), Math.cos(a * D), 0);
      out.push(box(`Point_${i + 1}`, d.multiplyScalar(0.38 * s).toArray(), [0.24 * s, 0.4 * s, 0.22 * s], [0, 0, -a], shade(p, 0.95), { material: c.material || 'neon' }));
    }
    return out;
  },
};

// Place one detail: anchor point, outward normal, roll around the normal, size, colors.
export function detailParts({ kind, position, normal = [0, 1, 0], roll = 0, size, colors = {}, group, parent }) {
  const make = DETAILS[kind];
  if (!make) throw new Error(`Unknown detail "${kind}" (use ${Object.keys(DETAILS).join(', ')})`);
  const DEF = { leaf: 2.2, sprig: 1.2, fruit: 1.3, flower: 1.6, crystal: 2.6, studded_plate: 1.4, ornament: 0.8, lantern: 1, spot: 1, drip: 1.4, star: 1.8 };
  const s = size || DEF[kind];
  // hanging details (drip, ornament, lantern) always hang straight down, whatever the face
  const n = HANGING.has(kind) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(...normal).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll * D));
  const P = new THREE.Vector3(...position);
  return make(s, colors).map((pc) => {
    const wq = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pc.rot[0] * D, pc.rot[1] * D, pc.rot[2] * D, 'XYZ')));
    const e = new THREE.Euler().setFromQuaternion(wq, 'XYZ');
    const { pos, rot, ...rest } = pc;
    return { ...rest, parent: group, ...(parent && !group ? { parent } : {}), position: P.clone().add(new THREE.Vector3(...pos).applyQuaternion(q)).toArray().map(r), size: pc.size.map(r), rotation: [e.x, e.y, e.z].map((v) => Math.round((v / D) * 100) / 100), color: pc.color };
  });
}

// Visible outward faces of the target parts, spread evenly all around the tree (by direction
// and height), so the back and sides get as many details as the front.
// on: group name / part name prefix / hex color; faces: 'side' | 'top' | 'bottom' | 'all'.
export function scatterTargets(model, allParts, { on, count = 8, faces = 'side', margin = 0.25 }) {
  const byId = new Map(model.parts.map((p) => [p.id, p]));
  const inGroup = (p, name) => { for (let q = p; q; q = byId.get(q.parent)) if (q.name === name) return true; return false; };
  const want = (p) => !on || p.color === on || p.name.startsWith(on) || inGroup(byId.get(p.id), on);
  const targets = allParts.filter(want);
  if (!targets.length) throw new Error(`No parts match "${on}".`);
  const cx = targets.reduce((s, p) => s + p.position[0], 0) / targets.length, cz = targets.reduce((s, p) => s + p.position[2], 0) / targets.length;
  const inside = (A, w) => { const d = [0, 1, 2].map((i) => w[i] - A.position[i]); return [0, 1, 2].every((j) => Math.abs(A.R[0][j] * d[0] + A.R[1][j] * d[1] + A.R[2][j] * d[2]) < A.size[j] / 2); };
  const cands = [];
  for (const p of targets) for (let j = 0; j < 3; j++) for (const sgn of [-1, 1]) {
    const n = [p.R[0][j] * sgn, p.R[1][j] * sgn, p.R[2][j] * sgn];
    const up = n[1];
    if (faces === 'side' && Math.abs(up) > 0.5) continue;
    if (faces === 'top' && up < 0.7) continue;
    if (faces === 'bottom' && up > -0.7) continue;
    const c = p.position.map((v, i) => v + n[i] * p.size[j] / 2);
    const radial = [c[0] - cx, 0, c[2] - cz], rl = Math.hypot(radial[0], radial[2]) || 1;
    if (faces === 'side' && (n[0] * radial[0] + n[2] * radial[2]) / rl < 0.3) continue; // faces outward
    const probe = c.map((v, i) => v + n[i] * margin);
    if (allParts.some((q) => q !== p && inside(q, probe))) continue; // covered by another part
    const other = [0, 1, 2].filter((k) => k !== j);
    if (Math.min(p.size[other[0]], p.size[other[1]]) < 0.8) continue; // too small a face
    cands.push({ c, n, az: Math.atan2(radial[0], radial[2]), y: c[1], area: p.size[other[0]] * p.size[other[1]], p, other });
  }
  if (!cands.length) throw new Error('No free outward faces found on those parts.');
  // farthest-point picking on (direction, height) so details spread all the way around
  const ys = cands.map((k) => k.y), yr = Math.max(...ys) - Math.min(...ys) || 1;
  const dist = (a, b) => { const da = Math.abs(a.az - b.az), dd = Math.min(da, 2 * Math.PI - da) / Math.PI; return Math.hypot(dd, (a.y - b.y) / yr * 0.7); };
  const pick = [cands.reduce((b, k) => (k.area > b.area ? k : b), cands[0])];
  while (pick.length < Math.min(count, cands.length)) {
    let best = null, bd = -1;
    for (const k of cands) { if (pick.includes(k)) continue; const d = Math.min(...pick.map((q) => dist(q, k))); if (d > bd) { bd = d; best = k; } }
    pick.push(best);
  }
  // offset each anchor a little inside its face (deterministic) so they don't line up
  return pick.map((k, i) => {
    const off = [((i * 37) % 7) / 7 - 0.5, ((i * 53) % 5) / 5 - 0.5];
    const pos = k.c.slice();
    k.other.forEach((ax, m) => { for (let t = 0; t < 3; t++) pos[t] += k.p.R[t][ax] * off[m] * k.p.size[ax] * 0.4; });
    return { position: pos.map((v) => Math.round(v * 1000) / 1000), normal: k.n, roll: (i * 47) % 90 - 45 };
  });
}
