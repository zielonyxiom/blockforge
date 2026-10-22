// Tree helpers that don't need the browser: the house-style root recipe
// (training/STYLE.md §6, as on the Sakura / Tree_Big / Apple trees).
import * as THREE from 'three';

const D = Math.PI / 180;
const r = (v) => Math.round(v * 1000) / 1000;
const euler = (q) => { const e = new THREE.Euler().setFromQuaternion(q, 'XYZ'); return [e.x, e.y, e.z].map((v) => Math.round((v / D) * 100) / 100); };
const yawQ = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * D);
const UP = new THREE.Vector3(0, 1, 0);

// A box from A to B (its local Z runs along A→B, local Y as close to up as possible),
// shifted vertically so its lowest corner sits at `floor`.
function slab(A, B, width, thick, floor) {
  const z = B.clone().sub(A).normalize();
  const x = new THREE.Vector3().crossVectors(UP, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const len = A.distanceTo(B), c = A.clone().add(B).multiplyScalar(0.5);
  let low = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    low = Math.min(low, c.y + new THREE.Vector3(sx * width / 2, sy * thick / 2, sz * len / 2).applyQuaternion(q).y);
  }
  c.y += floor - low;
  return { position: c.toArray().map(r), size: [r(width), r(thick), r(len)], rotation: euler(q) };
}

// Collar + step around the trunk base, 6 two-part roots in uneven directions
// (0° = front, +Z), and two knots. Scaled to the trunk width (recipe is for ~2 wide);
// `spread` scales only the root lengths (0.6 for short feet, 1.3 for long crawling roots).
export function rootParts({ position = [0, 0], ground = 0, trunkWidth = 2, spread = 1, color = '#5a3f2e', group = 'Roots', parent } = {}) {
  const s = trunkWidth / 2, [cx, cz] = position;
  const axis = new THREE.Vector3(cx, ground, cz);
  const common = { color, material: 'smooth', variant: '2022 Small Stud', parent: group };
  const parts = [{ kind: 'group', name: group, ...(parent ? { parent } : {}), pivot: [cx, ground, cz] }];
  const collarH = 0.9 * trunkWidth;
  parts.push({ ...common, name: 'Collar', position: [cx, r(ground + collarH / 2), cz], size: [r(1.25 * trunkWidth), r(collarH), r(1.25 * trunkWidth)], rotation: [0, 4, 0] });
  parts.push({ ...common, name: 'CollarStep', position: [cx, r(ground + collarH + 0.3), cz], size: [r(1.1 * trunkWidth), 0.6, r(1.1 * trunkWidth)], rotation: [0, -6, 0] });
  // [direction°, main length, tilt°, thickness, width] — the back root is the longest and steepest
  const ROOTS = [[-38, 2.7, 50, 1.2, 0.95], [33, 2.5, 47, 1.1, 0.85], [90, 2.9, 52, 1.3, 1.0], [-95, 2.6, 48, 1.15, 0.9], [180, 3.6, 58, 1.45, 1.15], [140, 2.4, 45, 1.0, 0.75]];
  ROOTS.forEach(([dir, L0, tilt, T0, W0], i) => {
    const L = L0 * s * spread, T = T0 * s, W = W0 * s;
    const d = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ(dir));
    const A = axis.clone().addScaledVector(d, 0.5 * s).addScaledVector(UP, L * Math.sin(tilt * D) * 0.95);
    const B = A.clone().addScaledVector(d, L * Math.cos(tilt * D)).addScaledVector(UP, -L * Math.sin(tilt * D));
    const main = slab(A, B, W, T, ground + 0.15);
    parts.push({ ...common, name: `Root_${i + 1}`, ...main });
    // the tip continues outward from the main slab's outer end at ~18°, sinking 0.1 into the ground
    const end = new THREE.Vector3(...main.position).addScaledVector(d, (L / 2) * Math.cos(tilt * D));
    end.y = ground + 0.2 * s;
    const Lt = (1.1 + (i % 3) * 0.35) * s * spread;
    const C = end.clone().addScaledVector(d, Lt * Math.cos(18 * D)).addScaledVector(UP, -Lt * Math.sin(18 * D));
    parts.push({ ...common, name: `Root_${i + 1}_Tip`, ...slab(end, C, 0.75 * W, 0.6 * T, ground - 0.1) });
  });
  const kd = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ(20));
  parts.push({ ...common, name: 'Knot', position: [r(cx + kd.x * 0.63 * trunkWidth), r(ground + collarH * 0.6), r(cz + kd.z * 0.63 * trunkWidth)], size: [0.38, 0.38, 0.38], rotation: [0, 20, 0] });
  const kd2 = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ(-120));
  parts.push({ ...common, name: 'Knot', position: [r(cx + kd2.x * 0.5 * trunkWidth), r(ground + collarH + 1.6 * s), r(cz + kd2.z * 0.5 * trunkWidth)], size: [0.3, 0.3, 0.3], rotation: [0, -120, 0] });
  return parts;
}

// The user's Sunflower roots (Flower_Tree_2, measured in Studio): a ring of 4 low collar
// blocks around the stem, then 4 roots, each a chain of flat slabs lying on the ground that
// get thinner and smaller toward a pointed tip, turning a little as they go (a low star).
// Sizes are in stem widths w: [distance from the axis, long side, thickness, short side].
const SUNFLOWER_CHAIN = [[0.62, 1.15, 0.34, 0.6], [1.06, 0.75, 0.22, 0.45], [1.37, 0.4, 0.17, 0.3], [1.55, 0.42, 0.13, 0.17]];
export function sunflowerRoots({ position = [0, 0], ground = 0, trunkWidth = 1.4, spread = 1, count = 4, color = '#4a701d', group = 'Roots', parent } = {}) {
  const w = trunkWidth, [cx, cz] = position;
  const common = { color, material: 'smooth', variant: '2022 Small Stud', parent: group };
  const parts = [{ kind: 'group', name: group, ...(parent ? { parent } : {}), pivot: [cx, ground, cz] }];
  const at = (yaw, dist) => { const d = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ(yaw)); return [r(cx + d.x * dist), r(cz + d.z * dist)]; };
  // collar ring: 4 blocks hugging the stem base, each turned a little
  [0, 90, 180, 270].forEach((yaw, i) => {
    const [x, z] = at(yaw + 10, 0.37 * w), h = (0.5 + 0.06 * (i % 2)) * w;
    parts.push({ ...common, name: 'Collar', position: [x, r(ground + h / 2), z], size: [r(0.8 * w), r(h), r(0.8 * w)], rotation: [0, r(yaw + 10 + (i % 2 ? -4 : 3)), 0] });
  });
  for (let i = 0; i < count; i++) {
    const base = 10 + (360 / count) * i + [0, 7, -6, 4, -3, 8][i % 6];
    SUNFLOWER_CHAIN.forEach(([dist, long, thick, short], k) => {
      const yaw = base + 9 * k; // the chain swirls a little
      const [x, z] = at(yaw, dist * w * (k ? spread : 1));
      // long side (X) points outward: rotate X onto the radial direction
      parts.push({ ...common, name: `Root_${i + 1}_${k + 1}`, position: [x, r(ground + (thick * w) / 2), z], size: [r(long * w * (k ? spread : 1)), r(Math.max(0.16, thick * w)), r(short * w)], rotation: [0, r(yaw - 90), 0] });
    });
  }
  return parts;
}

// Parts thinner than this read as glitchy strips in Roblox.
export const THIN = 0.15;
