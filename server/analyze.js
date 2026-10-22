// Structural analysis of a tree model (BlockForge format): splits it into roots, collar,
// trunk, branches, canopy blobs and details, and measures each part of the recipe.
// Used by scripts/analyze-trees.mjs (house statistics over the game's trees) and by the
// style_check tool (a build vs those statistics).

const D = Math.PI / 180;

// Euler XYZ (three.js order: R = Rx·Ry·Rz) → 3×3 rows
function rotMatrix([rx, ry, rz]) {
  const [a, b, c] = [rx * D, ry * D, rz * D];
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [
    [cb * cc, -cb * sc, sb],
    [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
    [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
  ];
}
const col = (R, j) => [R[0][j], R[1][j], R[2][j]];

const median = (a) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 100) / 100);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const colorDist = (a, b) => { const p = hexRgb(a), q = hexRgb(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// World-space description of every visible cube (group rotations are ignored: the imported
// trees and BlockForge builds keep them at 0).
function parts(model) {
  return model.parts.filter((p) => p.type !== 'group' && p.visible !== false).map((p) => {
    const R = rotMatrix(p.rotation || [0, 0, 0]);
    const half = p.size.map((s) => s / 2);
    const ext = [0, 1, 2].map((i) => Math.abs(R[i][0]) * half[0] + Math.abs(R[i][1]) * half[1] + Math.abs(R[i][2]) * half[2]);
    const longAxis = p.size.indexOf(Math.max(...p.size));
    const dir = col(R, longAxis);
    // angle between the part's long axis and the vertical
    const tilt = Math.acos(Math.min(1, Math.abs(dir[1]))) / D;
    // how far the part is turned off the 90° grid (max over its three axes)
    const off = Math.max(...[0, 1, 2].map((j) => { const v = col(R, j); const m = Math.max(...v.map(Math.abs)); return Math.acos(Math.min(1, m)) / D; }));
    return {
      ...p, R, dir, tilt, off,
      min: p.position.map((c, i) => c - ext[i]), max: p.position.map((c, i) => c + ext[i]),
      vol: p.size[0] * p.size[1] * p.size[2], thin: Math.min(...p.size),
    };
  });
}

export function analyzeTree(model) {
  const P = parts(model);
  if (!P.length) return { parts: 0 };
  const min = [0, 1, 2].map((i) => Math.min(...P.map((p) => p.min[i])));
  const max = [0, 1, 2].map((i) => Math.max(...P.map((p) => p.max[i])));
  const [W, H, Dp] = [0, 1, 2].map((i) => max[i] - min[i]);
  const y = (f) => min[1] + f * H;

  // colors by volume
  const volBy = (list) => { const m = new Map(); for (const p of list) m.set(p.color, (m.get(p.color) || 0) + p.vol); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const lower = P.filter((p) => p.position[1] > y(0.05) && p.position[1] < y(0.45));
  const wood = volBy(lower)[0]?.[0] ?? P[0].color;
  const isWood = (p) => colorDist(p.color, wood) < 40;
  const upperNonWood = P.filter((p) => p.position[1] > y(0.5) && !isWood(p));
  const leaf = volBy(upperNonWood)[0]?.[0] ?? null;
  const isLeaf = (p) => leaf && colorDist(p.color, leaf) < 45;

  // trunk axis: middle of the wood parts between 10 and 40 % of the height
  const shaft = P.filter((p) => isWood(p) && p.position[1] > y(0.1) && p.position[1] < y(0.4));
  const axis = [median(shaft.map((p) => p.position[0])) ?? (min[0] + max[0]) / 2, median(shaft.map((p) => p.position[2])) ?? (min[2] + max[2]) / 2];
  const hdist = (p) => Math.hypot(p.position[0] - axis[0], p.position[2] - axis[1]);
  const trunkW = median(shaft.map((p) => Math.min(p.size[0], p.size[2]))) ?? 1;

  const canopy = P.filter(isLeaf);
  const canopyStart = canopy.length ? Math.min(...canopy.map((p) => p.min[1])) : max[1];
  const roles = new Map();
  for (const p of P) {
    if (isLeaf(p)) { roles.set(p, 'canopy'); continue; }
    if (isWood(p)) {
      const low = p.max[1] < y(0.3);
      // a root is elongated and points outward (its long axis runs away from the trunk)
      const sz = [...p.size].sort((a, b) => b - a), radial = [p.position[0] - axis[0], p.position[2] - axis[1]];
      const rl = Math.hypot(...radial), hl = Math.hypot(p.dir[0], p.dir[2]);
      const outward = rl > 1e-6 && hl > 0.3 && Math.abs((p.dir[0] * radial[0] + p.dir[2] * radial[1]) / (rl * hl)) > 0.6;
      const sloped = p.tilt > 20 && p.tilt < 80; // runs down and out (10–70° below horizontal)
      if (low && hdist(p) > 0.45 * trunkW && ((sz[0] > 1.4 * sz[1] && outward) || (sloped && sz[0] > 1.15 * sz[2]))) roles.set(p, 'root');
      else if (low && p.max[1] < y(0.12) && hdist(p) > 0.55 * trunkW) roles.set(p, 'base');
      else if (low && hdist(p) < 0.6 * trunkW && Math.max(p.size[0], p.size[2]) > 1.05 * trunkW && p.size[1] < Math.max(p.size[0], p.size[2])) roles.set(p, 'collar');
      else if (p.position[1] < canopyStart + 0.05 * H && hdist(p) < 0.9 * trunkW && p.tilt < 35) roles.set(p, 'trunk');
      else roles.set(p, 'branch');
      continue;
    }
    roles.set(p, 'detail');
  }
  const of = (role) => P.filter((p) => roles.get(p) === role);
  const roots = of('root'), trunk = of('trunk'), branches = of('branch'), collar = of('collar'), details = of('detail'), base = of('base');

  // roots: two-part roots = a flatter tip next to a steeper slab
  const rootYaw = roots.map((p) => Math.round(Math.atan2(p.position[0] - axis[0], p.position[2] - axis[1]) / D));
  const rootSlope = roots.map((p) => 90 - p.tilt); // angle below horizontal
  const steep = roots.filter((p) => 90 - p.tilt > 30), flat = roots.filter((p) => 90 - p.tilt <= 30);
  // directions: distinct sectors of 45°
  const sectors = new Set(rootYaw.map((a) => Math.round(((a + 360) % 360) / 45) % 8));

  // trunk segments: sorted by height; taper and bend
  const segs = [...trunk].sort((a, b) => a.position[1] - b.position[1]);
  const widths = segs.map((p) => Math.min(p.size[0], p.size[2]));
  const taper = widths.length > 1 ? widths.slice(1).map((w, i) => w / widths[i]) : [];
  const bare = (canopyStart - (collar.length ? Math.max(...collar.map((p) => p.max[1])) : min[1])) / H;

  // canopy blobs: thick parts are cores (cores sharing about the same center are one blob);
  // thin parts touching a core at about its rotation (≤20°) are that blob's face plates
  const angle = (a, b) => { let tr = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += a.R[i][j] * b.R[i][j]; return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) / D; };
  const touch = (a, b) => [0, 1, 2].every((i) => a.min[i] <= b.max[i] + 0.3 && b.min[i] <= a.max[i] + 0.3);
  const isPlate = (p) => { const sz = [...p.size].sort((a, b) => b - a); return sz[2] <= 1.8 && sz[2] <= 0.45 * sz[1]; };
  const blobs = [];
  for (const p of [...canopy].filter((q) => !isPlate(q)).sort((a, b) => b.vol - a.vol)) {
    const near = blobs.find((bl) => Math.hypot(...[0, 1, 2].map((i) => bl.core.position[i] - p.position[i])) < 0.3 * Math.min(...bl.core.size));
    if (near) near.cores.push(p); else blobs.push({ core: p, cores: [p], plates: [] });
  }
  for (const p of canopy.filter(isPlate)) {
    const host = blobs.filter((bl) => bl.cores.some((c) => touch(c, p) && angle(c, p) <= 20)).sort((a, b) => b.core.vol - a.core.vol)[0];
    if (host) host.plates.push(p);
  }
  const realBlobs = blobs.filter((b) => b.core.vol > 0.05 * Math.max(...canopy.map((p) => p.vol)));
  const plates = realBlobs.flatMap((b) => b.plates);

  // front/back balance of small details (z relative to the median part)
  const zMid = median(P.map((p) => p.position[2]));
  const small = P.filter((p) => Math.max(...p.size) <= 0.2 * H);
  const front = small.filter((p) => p.position[2] > zMid + 0.15 * Dp).length, back = small.filter((p) => p.position[2] < zMid - 0.15 * Dp).length;

  return {
    parts: P.length, size: [W, H, Dp].map(r2), depth_width: r2(Dp / W), footprint: r2(Math.min(W, Dp) / Math.max(W, Dp)), height_width: r2(H / Math.max(W, Dp)),
    colors: { wood, leaf, count: new Set(P.map((p) => p.color)).size },
    tilted_share: r2(P.filter((p) => p.off > 2).length / P.length),
    thin_parts: P.filter((p) => p.thin <= 0.15).length,
    trunk: {
      segments: segs.length, base_width: r2(widths[0] ?? trunkW), top_width: r2(widths.at(-1) ?? trunkW),
      taper: r2(median(taper)), mean_tilt: r2(median(segs.map((p) => p.tilt))),
      width_rel: r2((widths[0] ?? trunkW) / W), bare_ratio: r2(bare),
    },
    collar: collar.length, base_slabs: base.length,
    roots: {
      count: roots.length, two_part: Math.min(steep.length, flat.length), directions: sectors.size,
      slope_median: r2(median(rootSlope)), slope_steep: r2(median(steep.map((p) => 90 - p.tilt))), slope_tip: r2(median(flat.map((p) => 90 - p.tilt))),
      length_rel: r2(median(roots.map((p) => Math.max(...p.size) / trunkW))), reach_rel: r2(roots.length ? Math.max(...roots.map(hdist)) / trunkW : 0),
    },
    branches: { count: branches.length, tilt_median: r2(median(branches.map((p) => p.tilt))) },
    canopy: {
      start_ratio: r2((canopyStart - min[1]) / H), parts: canopy.length, blobs: realBlobs.length,
      plates_per_blob: r2(realBlobs.length ? plates.length / realBlobs.length : 0),
      plate_thickness: r2(median(plates.map((p) => p.thin))),
      core_size: realBlobs.length ? realBlobs[0].core.size.map(r2) : null,
      width_rel: r2(canopy.length ? (Math.max(...canopy.map((p) => p.max[0])) - Math.min(...canopy.map((p) => p.min[0]))) / W : 0),
    },
    details: { count: details.length, front, back },
  };
}

// Distribution (median, p25, p75) of every numeric metric over many analyses.
export function summarize(list) {
  const out = {};
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'number') (out[key] ||= []).push(v);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
    }
  };
  for (const a of list) walk(a, '');
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { median: r2(median(v)), p25: r2(pct(v, 0.25)), p75: r2(pct(v, 0.75)), n: v.length }]));
}

// Human-readable comparison of one analysis with the house statistics.
export function styleReport(a, stats) {
  const lines = [];
  // side: 'both' = inside the usual range, 'min' = at least the low end (more is fine)
  const chk = (key, val, label, hint, side = 'both') => {
    const s = stats[key];
    if (!s || val === null || val === undefined) return;
    const lo = s.p25, hi = s.p75, ok = val >= lo * 0.9 && (side === 'min' || val <= hi * 1.1);
    lines.push(`${ok ? '✓' : '✗'} ${label}: ${val} (house ${s.median}, usual ${lo}–${hi})${ok ? '' : ' → ' + hint}`);
  };
  chk('footprint', a.footprint, 'footprint (narrow side / wide side)', 'make it deeper (or flatter) to match');
  chk('tilted_share', a.tilted_share, 'share of tilted parts', 'tilt more parts (organic 2–25° tilts)');
  chk('trunk.bare_ratio', a.trunk.bare_ratio, 'bare trunk between collar and canopy (× height)', 'raise or lower the canopy');
  chk('trunk.width_rel', a.trunk.width_rel, 'trunk base width (× tree width)', 'resize the trunk');
  chk('canopy.start_ratio', a.canopy.start_ratio, 'canopy starts at (× height)', 'move the canopy');
  chk('canopy.plates_per_blob', a.canopy.plates_per_blob, 'face plates per canopy blob', 'add plates with the core rotation on the blob faces', 'min');
  chk('parts', a.parts, 'part count', 'more/less detail', 'min');
  // roots: judged against the root recipe (collar + 5–6 two-part roots all around), since many
  // of the game's trees use a flat base slab instead and would pull the statistics to 0
  if (a.trunk.segments) {
    const ok = a.roots.count >= 5 && a.roots.directions >= 4;
    lines.push(`${ok ? '✓' : '✗'} roots: ${a.roots.count} part(s) in ${a.roots.directions} direction(s), slope ${a.roots.slope_median ?? '–'}° (recipe: 5–6 two-part roots all around, main slabs 45–58°)${ok ? '' : ' → use tree_roots, unless the picture shows a pot or a stepped base'}`);
  }
  if (a.thin_parts) lines.push(`✗ ${a.thin_parts} part(s) ≤0.15 thick → make them chunkier or delete them`);
  if (a.details.front >= 3 && a.details.back < a.details.front / 2) lines.push(`✗ details front ${a.details.front} / back ${a.details.back} → give the back its own details`);
  return lines.join('\n');
}
