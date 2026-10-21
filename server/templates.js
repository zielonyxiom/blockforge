// House-style tree templates: the game's own hand-made trees, converted to BlockForge
// models in training/studio-trees/ (index.json + one <name>.json per tree, editor
// coordinates, bottom-center at the origin, front = +Z).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { labDistance } from './roblox.js';

export const TEMPLATE_DIR = path.join(ROOT, 'training', 'studio-trees');

export function treeIndex() {
  const file = path.join(TEMPLATE_DIR, 'index.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

export function loadTemplate(name) {
  const entry = treeIndex().find((t) => [t.file, t.file.replace(/\.json$/, ''), t.name].some((n) => n.toLowerCase() === String(name).toLowerCase()));
  if (!entry) throw new Error(`No tree template "${name}". Call tree_template without a file to list them.`);
  return { entry, model: JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, entry.file), 'utf8')) };
}

// Rank templates by shape (width/height and depth/height ratios, log scale) and by how
// close their colors are to the scan's wood and leaf colors (ΔE / 40: a matching palette
// usually means the same kind of tree, so it weighs about as much as the shape).
export function closestTrees({ size, wood, leaf }, n = 3) {
  const [w, h, d] = size;
  const near = (hex, colors) => Math.min(...colors.map((c) => labDistance(hex, c)));
  return treeIndex().map((t) => {
    const [tw, th, td] = t.extents;
    // depth counts less: the scan's depth is the least reliable axis
    const shape = 2 * Math.abs(Math.log((w / h) / (tw / th))) + Math.abs(Math.log((d / h) / (td / th)));
    const color = t.colors?.length ? ((wood ? near(wood, t.colors) : 0) + (leaf ? near(leaf, t.colors) : 0)) / 40 : 1;
    return { ...t, score: Math.round((shape + color) * 100) / 100 };
  }).sort((a, b) => a.score - b.score).slice(0, n);
}

// add_parts input for a template, scaled uniformly to `height` and placed at `offset`.
export function templateParts(model, { height, offset = [0, 0, 0], prefix }) {
  const cubes = model.parts.filter((p) => p.type !== 'group');
  let top = 0;
  for (const c of cubes) top = Math.max(top, c.position[1] + Math.max(...c.size) / 2);
  const s = height && top > 0 ? height / top : 1;
  const r = (v) => Math.round(v * 1000) / 1000;
  const groupName = new Map();
  const out = [{ kind: 'group', name: prefix, pivot: offset }];
  for (const p of model.parts) {
    const parent = p.parent ? groupName.get(p.parent) : prefix;
    if (p.type === 'group') {
      // children find their group by name, so group names must be unique here
      let name = `${prefix}_${p.name}`;
      for (let i = 2; [...groupName.values()].includes(name); i++) name = `${prefix}_${p.name}_${i}`;
      groupName.set(p.id, name);
      out.push({ kind: 'group', name, parent, pivot: p.pivot.map((v, i) => r(v * s + offset[i])), rotation: p.rotation });
    } else {
      out.push({
        name: p.name, parent,
        position: p.position.map((v, i) => r(v * s + offset[i])), size: p.size.map((v) => r(v * s)), rotation: p.rotation,
        color: p.color, shape: p.shape, material: p.material,
        ...(p.variant ? { variant: p.variant } : {}), ...(p.gradientDecals !== undefined ? { gradientDecals: p.gradientDecals } : {}),
      });
    }
  }
  return { parts: out, scale: Math.round(s * 1000) / 1000 };
}
