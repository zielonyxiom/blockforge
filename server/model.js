// Model state + command engine. The server owns the model; the browser editor,
// the Claude build agent and the MCP server all mutate it through exec().
//
// Coordinate system (shared with the editor + prompts):
//   1 unit = 1 stud, Y is up, the model FACES +Z.
//   The character's LEFT side is +X, its RIGHT side is -X.
//   Cube `position` is the cube CENTER in absolute model space.
//   Group `pivot` is an absolute point; group `rotation` rotates all children around it.
//   Rotations are Euler degrees [x, y, z] (XYZ order).

import { ROBLOX_MATERIALS, BRICKCOLORS, VARIANTS, snapModel } from './roblox.js';

export const SHAPES = ['box', 'cylinder', 'sphere', 'wedge'];
export const MATERIALS = Object.keys(ROBLOX_MATERIALS);
// smooth = no studs · studs = classic stud tops + inlet bottoms · studs_all = studs on every face (inlets below)
// house = the game's own look: SmoothPlastic + 2022 MaterialVariants + gradient decals
export const STYLES = ['smooth', 'studs', 'studs_all', 'house'];
export const isStuds = (style) => String(style || '').startsWith('studs');

const MAX_HISTORY = 200;

export function emptyModel(name = 'Untitled', style = 'smooth') {
  return { name, style, nextId: 1, parts: [] };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (n) => Math.round(n * 1000) / 1000;

// Models sometimes send vectors as text ("[2,2,2]", "2, 2, 2") or numbers as strings.
function coerceVec(v) {
  if (typeof v === 'string') {
    const s = v.trim();
    try { const j = JSON.parse(s); if (Array.isArray(j) || typeof j === 'number') return coerceVec(j); } catch {}
    const nums = s.replace(/[[\](){}]/g, ' ').split(/[\s,;]+/).filter(Boolean).map(Number);
    return nums.length === 1 ? nums[0] : nums;
  }
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' && x.trim() !== '' && isFinite(Number(x)) ? Number(x) : x));
  if (v && typeof v === 'object' && 'x' in v && 'y' in v && 'z' in v) return [v.x, v.y, v.z].map(Number);
  return v;
}

function vec3(v, fallback, label) {
  if (v === undefined || v === null) return fallback;
  v = coerceVec(v);
  if (typeof v === 'number') return [v, v, v];
  if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number' || !isFinite(x))) {
    throw new Error(`${label} must be an array of 3 numbers, got ${JSON.stringify(v)}`);
  }
  return v.map(round);
}

const BASIC_COLORS = {
  red: '#c4281c', green: '#4b974b', blue: '#0d69ac', yellow: '#f5cd30', orange: '#da8541', purple: '#6b327c',
  pink: '#ff66cc', brown: '#694028', white: '#f2f3f3', black: '#1b2a35', gray: '#a3a2a5', grey: '#a3a2a5',
  cyan: '#04afec', lime: '#00ff00', gold: '#dcbc81', silver: '#9ca3a8', beige: '#cabfa3', tan: '#d7c59a',
};
function variant(v) {
  const hit = VARIANTS.find((x) => x.toLowerCase() === String(v).trim().toLowerCase());
  if (!hit) throw new Error(`variant must be one of ${VARIANTS.join(', ')}`);
  return hit;
}
function color(c, fallback) {
  if (c === undefined || c === null) return fallback;
  if (typeof c === 'string') {
    const s = c.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(s)) return (s.startsWith('#') ? s : '#' + s).toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) return ('#' + [...s.slice(1)].map((ch) => ch + ch).join('')).toLowerCase();
    // BrickColor names ("Bright red", "Sand blue") and basic color words
    const name = s.toLowerCase();
    const brick = Object.entries(BRICKCOLORS).find(([n]) => n.toLowerCase() === name);
    if (brick) return brick[1];
    if (BASIC_COLORS[name]) return BASIC_COLORS[name];
  }
  throw new Error(`color must be a hex string like "#a1b2c3" or a BrickColor name, got ${JSON.stringify(c)}`);
}

const SIDE_SWAP = { Left: 'Right', Right: 'Left', left: 'right', right: 'left', LEFT: 'RIGHT', RIGHT: 'LEFT' };
function mirrorName(name) {
  let out = name.replace(/Left|Right|left|right|LEFT|RIGHT/g, (m) => SIDE_SWAP[m]);
  // Single-letter side tags: "Eye_L", "L_Arm", "Leg.R"
  if (out === name) out = name.replace(/(^|[^A-Za-z])([LR])(?=$|[^A-Za-z])/g, (m, a, s) => a + (s === 'L' ? 'R' : 'L'));
  return out === name ? name + '_mirror' : out;
}

export class ModelStore {
  constructor(model = emptyModel()) {
    this.model = model;
    this.past = [];
    this.future = [];
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(source) { for (const fn of this.listeners) fn(this.model, source); }

  // ---- lookup helpers ----
  find(ref) {
    if (ref === undefined || ref === null || ref === '') return null;
    const parts = this.model.parts;
    ref = String(ref).trim();
    const hit = parts.find((p) => p.id === ref) || parts.find((p) => p.name === ref) ||
      parts.find((p) => p.name.toLowerCase() === ref.toLowerCase());
    if (hit) return hit;
    // "p12:Head" (the format add_parts reports back) → id, then name
    const m = /^(p\d+):(.*)$/.exec(ref);
    if (m) return parts.find((p) => p.id === m[1]) || parts.find((p) => p.name === m[2].trim()) || null;
    return null;
  }
  get(ref) {
    const p = this.find(ref);
    if (!p) throw new Error(`No part with id or name "${ref}"`);
    return p;
  }
  children(id) { return this.model.parts.filter((p) => p.parent === id); }
  descendants(id) {
    const out = [];
    const walk = (pid) => { for (const c of this.children(pid)) { out.push(c); walk(c.id); } };
    walk(id);
    return out;
  }
  uniqueName(name) {
    const base = (name || 'part').trim() || 'part';
    if (!this.model.parts.some((p) => p.name === base)) return base;
    let i = 2;
    while (this.model.parts.some((p) => p.name === `${base}_${i}`)) i++;
    return `${base}_${i}`;
  }
  resolveParent(ref) {
    if (ref === undefined || ref === null || ref === '' || ref === 'root') return null;
    const p = this.get(ref);
    if (p.type !== 'group') throw new Error(`Parent "${ref}" is a cube, parents must be groups`);
    return p.id;
  }

  // ---- part builders ----
  makeGroup(spec) {
    return {
      id: 'p' + this.model.nextId++,
      type: 'group',
      name: this.uniqueName(spec.name || 'group'),
      parent: this.resolveParent(spec.parent),
      pivot: vec3(spec.pivot, [0, 0, 0], 'pivot'),
      rotation: vec3(spec.rotation, [0, 0, 0], 'rotation'),
      visible: spec.visible !== false,
    };
  }
  makeCube(spec) {
    const shape = spec.shape || 'box';
    if (!SHAPES.includes(shape)) throw new Error(`shape must be one of ${SHAPES.join(', ')}`);
    const material = spec.material || (isStuds(this.model.style) ? 'plastic' : 'smooth');
    if (!MATERIALS.includes(material)) throw new Error(`material must be one of ${MATERIALS.join(', ')}`);
    const size = vec3(spec.size, [1, 1, 1], 'size');
    if (size.some((s) => s <= 0)) throw new Error('size values must be > 0');
    return {
      id: 'p' + this.model.nextId++,
      type: 'cube',
      name: this.uniqueName(spec.name || 'cube'),
      parent: this.resolveParent(spec.parent),
      position: vec3(spec.position, [0, 0, 0], 'position'),
      size,
      rotation: vec3(spec.rotation, [0, 0, 0], 'rotation'),
      color: color(spec.color, '#a3a2a5'),
      shape,
      material,
      visible: spec.visible !== false,
      ...(spec.variant ? { variant: variant(spec.variant) } : {}),
      ...(spec.gradientDecals !== undefined ? { gradientDecals: !!spec.gradientDecals } : {}),
    };
  }

  applyUpdate(p, u) {
    if (u.name !== undefined && u.name !== p.name) p.name = this.uniqueName(u.name);
    if (u.parent !== undefined) {
      const np = this.resolveParent(u.parent);
      if (np === p.id || (np && this.descendants(p.id).some((d) => d.id === np))) throw new Error('Cannot parent a group into itself');
      p.parent = np;
    }
    if (u.visible !== undefined) p.visible = !!u.visible;
    if (u.rotation !== undefined) p.rotation = vec3(u.rotation, p.rotation, 'rotation');
    if (p.type === 'group') {
      if (u.pivot !== undefined) p.pivot = vec3(u.pivot, p.pivot, 'pivot');
    } else {
      if (u.position !== undefined) p.position = vec3(u.position, p.position, 'position');
      if (u.size !== undefined) {
        const s = vec3(u.size, p.size, 'size');
        if (s.some((x) => x <= 0)) throw new Error('size values must be > 0');
        p.size = s;
      }
      if (u.color !== undefined) p.color = color(u.color, p.color);
      if (u.shape !== undefined) { if (!SHAPES.includes(u.shape)) throw new Error('bad shape'); p.shape = u.shape; }
      if (u.material !== undefined) { if (!MATERIALS.includes(u.material)) throw new Error('bad material'); p.material = u.material; }
      if (u.variant !== undefined) { if (u.variant) p.variant = variant(u.variant); else delete p.variant; }
      if (u.gradientDecals !== undefined) p.gradientDecals = !!u.gradientDecals;
    }
    // Relative helpers
    if (u.move !== undefined) {
      const d = vec3(u.move, [0, 0, 0], 'move');
      const targets = p.type === 'group' ? [p, ...this.descendants(p.id)] : [p];
      for (const t of targets) {
        if (t.type === 'group') t.pivot = t.pivot.map((v, i) => round(v + d[i]));
        else t.position = t.position.map((v, i) => round(v + d[i]));
      }
    }
  }

  // ---- command execution (undoable) ----
  exec(cmd, source = 'api') {
    const before = clone(this.model);
    let result;
    try {
      result = this.run(cmd);
    } catch (e) {
      this.model = before; // roll back partial batches
      throw e;
    }
    if (result?.noHistory) { delete result.noHistory; return result; }
    this.past.push(before);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.emit(source);
    return result;
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push(clone(this.model));
    this.model = this.past.pop();
    this.emit('undo');
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.past.push(clone(this.model));
    this.model = this.future.pop();
    this.emit('redo');
    return true;
  }

  run(cmd) {
    const op = cmd.op;
    switch (op) {
      case 'add_group': {
        const g = this.makeGroup(cmd);
        this.model.parts.push(g);
        return { id: g.id, name: g.name };
      }
      case 'add_cube': {
        const c = this.makeCube(cmd);
        this.model.parts.push(c);
        return { id: c.id, name: c.name };
      }
      case 'add_parts': {
        if (!Array.isArray(cmd.parts) || !cmd.parts.length) throw new Error('parts must be a non-empty array');
        const created = [];
        for (const [i, spec] of cmd.parts.entries()) {
          try {
            const kind = spec.kind || spec.type || (spec.pivot && !spec.size ? 'group' : 'cube');
            const p = kind === 'group' ? this.makeGroup(spec) : this.makeCube(spec);
            this.model.parts.push(p);
            created.push(`${p.id}:${p.name}`);
          } catch (e) {
            throw new Error(`parts[${i}] (${spec.name || 'unnamed'}): ${e.message}`);
          }
        }
        return { created };
      }
      case 'update_part': {
        const p = this.get(cmd.id ?? cmd.name);
        this.applyUpdate(p, cmd);
        return { id: p.id, name: p.name };
      }
      case 'update_parts': {
        if (!Array.isArray(cmd.updates)) throw new Error('updates must be an array');
        const done = [];
        for (const [i, u] of cmd.updates.entries()) {
          try {
            const p = this.get(u.id ?? u.target);
            this.applyUpdate(p, u);
            done.push(p.name);
          } catch (e) {
            throw new Error(`updates[${i}]: ${e.message}`);
          }
        }
        return { updated: done };
      }
      case 'delete_parts':
      case 'delete_part': {
        const ids = cmd.ids || [cmd.id];
        const kill = new Set();
        for (const ref of ids) {
          const p = this.get(ref);
          kill.add(p.id);
          for (const d of this.descendants(p.id)) kill.add(d.id);
        }
        this.model.parts = this.model.parts.filter((p) => !kill.has(p.id));
        return { deleted: kill.size };
      }
      case 'duplicate_part': {
        return this.copySubtree(this.get(cmd.id), { offset: vec3(cmd.offset, [0, 0, 0], 'offset') });
      }
      case 'mirror_part': {
        const axis = cmd.axis || 'x';
        if (!['x', 'y', 'z'].includes(axis)) throw new Error('axis must be x, y or z');
        return this.copySubtree(this.get(cmd.id), { mirror: axis });
      }
      case 'clear_model': {
        this.model = emptyModel(cmd.name || this.model.name, this.model.style);
        return { ok: true };
      }
      case 'set_name': {
        this.model.name = String(cmd.name || 'Untitled');
        return { ok: true };
      }
      case 'set_style': {
        if (!STYLES.includes(cmd.style)) throw new Error(`style must be one of ${STYLES.join(', ')}`);
        this.model.style = cmd.style;
        return { ok: true, style: cmd.style };
      }
      case 'roblox_snap': {
        if (this.model.style === 'house' && !cmd.mode) return { mode: 'house', changed: 0, note: 'House style keeps free sizes and tilts: nothing snapped. Pass mode explicitly to force it.' };
        const mode = cmd.mode || (isStuds(this.model.style) ? 'studs' : 'smooth');
        const changed = snapModel(this.model, { mode, colors: cmd.colors !== false, keepTilt: !!cmd.keep_tilt });
        return { mode, changed };
      }
      case 'load_model': {
        const m = cmd.model;
        if (!m || !Array.isArray(m.parts)) throw new Error('model must have a parts array');
        this.model = { name: m.name || 'Untitled', style: STYLES.includes(m.style) ? m.style : 'smooth', nextId: m.nextId || m.parts.length + 1, parts: m.parts };
        // make sure nextId never collides
        for (const p of this.model.parts) {
          const n = parseInt(String(p.id).replace(/\D/g, ''), 10);
          if (n >= this.model.nextId) this.model.nextId = n + 1;
        }
        return { ok: true, parts: this.model.parts.length };
      }
      default:
        throw new Error(`Unknown op "${op}"`);
    }
  }

  copySubtree(root, { offset = [0, 0, 0], mirror = null }) {
    const ai = mirror ? { x: 0, y: 1, z: 2 }[mirror] : -1;
    const flipVec = (v) => v.map((x, i) => round(i === ai ? -x : x + offset[i]));
    // Reflection across an axis plane negates the two rotation components that are NOT that axis.
    const flipRot = (r) => (ai < 0 ? [...r] : r.map((x, i) => (i === ai ? x : round(-x))));
    const idMap = new Map();
    const list = [root, ...this.descendants(root.id)];
    const created = [];
    for (const src of list) {
      const copy = clone(src);
      copy.id = 'p' + this.model.nextId++;
      idMap.set(src.id, copy.id);
      copy.parent = src === root ? src.parent : idMap.get(src.parent);
      copy.name = this.uniqueName(mirror ? mirrorName(src.name) : src.name + '_copy');
      if (copy.type === 'group') copy.pivot = flipVec(src.pivot);
      else copy.position = flipVec(src.position);
      copy.rotation = flipRot(src.rotation);
      this.model.parts.push(copy);
      created.push(`${copy.id}:${copy.name}`);
    }
    return { created };
  }

  // Compact human/LLM-readable dump.
  describe() {
    const m = this.model;
    if (!m.parts.length) return `Model "${m.name}" is empty.`;
    const lines = [`Model "${m.name}" (${({ studs: 'classic studs on top', studs_all: 'studs on every face', smooth: 'smooth', house: 'house (2022 variants + gradient decals)' })[m.style] || 'smooth'} style) — ${m.parts.length} parts. Format: id name [type] ...`];
    const walk = (pid, depth) => {
      for (const p of this.children(pid)) {
        const pad = '  '.repeat(depth);
        if (p.type === 'group') {
          lines.push(`${pad}${p.id} ${p.name} [group] pivot=${JSON.stringify(p.pivot)} rot=${JSON.stringify(p.rotation)}${p.visible ? '' : ' hidden'}`);
          walk(p.id, depth + 1);
        } else {
          const rot = p.rotation.some((x) => x) ? ` rot=${JSON.stringify(p.rotation)}` : '';
          const extra = (p.shape !== 'box' ? ` shape=${p.shape}` : '') + (p.material !== 'plastic' ? ` mat=${p.material}` : '') + (p.variant ? ` variant="${p.variant}"` : '') + (p.gradientDecals === false ? ' noDecals' : '');
          lines.push(`${pad}${p.id} ${p.name} pos=${JSON.stringify(p.position)} size=${JSON.stringify(p.size)}${rot} ${p.color}${extra}${p.visible ? '' : ' hidden'}`);
        }
      }
    };
    walk(null, 0);
    const b = this.bounds();
    if (b) lines.push(`Bounds: min=${JSON.stringify(b.min)} max=${JSON.stringify(b.max)} (ignores rotation)`);
    return lines.join('\n');
  }

  bounds() {
    const cubes = this.model.parts.filter((p) => p.type === 'cube');
    if (!cubes.length) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const c of cubes) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], c.position[i] - c.size[i] / 2);
      max[i] = Math.max(max[i], c.position[i] + c.size[i] / 2);
    }
    return { min: min.map(round), max: max.map(round) };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions shared by the Claude build agent and the MCP server.
// ---------------------------------------------------------------------------

const V3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

const PART_PROPS = {
  kind: { type: 'string', enum: ['cube', 'group'], description: 'cube (default) or group' },
  name: { type: 'string', description: 'Unique, descriptive name, e.g. "Head", "LeftFrontLeg_Upper". Used as a reference by other parts.' },
  parent: { type: 'string', description: 'Name or id of a group to nest under (omit for root). Groups must be created before their children.' },
  position: { ...V3, description: 'cube only: CENTER of the cube in absolute model space [x,y,z]' },
  size: { ...V3, description: 'cube only: [width(x), height(y), depth(z)] in studs' },
  pivot: { ...V3, description: 'group only: absolute pivot point; group rotation rotates children around it (e.g. shoulder / hip joint)' },
  rotation: { ...V3, description: 'Euler degrees [x,y,z]. For cubes: around the cube center. For groups: around the pivot.' },
  color: { type: 'string', description: 'cube only: hex color "#rrggbb"' },
  shape: { type: 'string', enum: SHAPES, description: 'cube only: box (default), cylinder (axis = Y), sphere (ellipsoid fitting size), wedge (ramp: full height at -Z, slopes down to +Z)' },
  variant: { type: 'string', enum: [...VARIANTS, ''], description: 'cube only, house style: Roblox MaterialVariant written on export ("" = automatic: "2022 Small Stud" for wood-colored parts, else "2022 Small Universal")' },
  gradientDecals: { type: 'boolean', description: 'cube only, house style: add the 4 side-face shading decals on export (default true)' },
  material: { type: 'string', enum: MATERIALS, description: 'cube only: Roblox material. smooth = SmoothPlastic (default in smooth style), plastic (default in studs style), neon glows, glass is translucent, plus wood, woodplanks, slate, concrete, brick, granite, marble, cobblestone, fabric, grass, sand, ice, foil, diamondplate, corrodedmetal, forcefield' },
};

export const MODEL_TOOLS = [
  {
    name: 'get_model',
    description: 'Return the current model as an indented outline: every group and cube with id, name, position/pivot, size, rotation, color.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_parts',
    description: 'Add many groups and/or cubes in one call (preferred). Processed in order, so create a group before cubes that use it as parent. Names are made unique automatically.',
    input_schema: {
      type: 'object',
      properties: { parts: { type: 'array', items: { type: 'object', properties: PART_PROPS, required: ['name'] } } },
      required: ['parts'],
    },
  },
  {
    name: 'update_parts',
    description: 'Modify existing parts. Each update targets `id` (id or name) and sets any of: name, parent, position, size, rotation, pivot, color, shape, material, visible, or `move` (relative [dx,dy,dz] offset; moving a group moves its whole subtree).',
    input_schema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string', description: 'id or name of the part' }, move: { ...V3, description: 'relative offset' }, visible: { type: 'boolean' }, ...PART_PROPS },
            required: ['id'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'delete_parts',
    description: 'Delete parts by id or name. Deleting a group deletes everything inside it.',
    input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'mirror_part',
    description: 'Copy a part or a whole group subtree mirrored across the axis plane through the origin (default x: copies the character LEFT side (+X) to the RIGHT side (-X)). Left/Right in names are swapped automatically.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, axis: { type: 'string', enum: ['x', 'y', 'z'] } }, required: ['id'] },
  },
  {
    name: 'duplicate_part',
    description: 'Copy a part or group subtree, shifted by `offset`.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, offset: V3 }, required: ['id'] },
  },
  {
    name: 'clear_model',
    description: 'Delete everything and start an empty model.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } } },
  },
  {
    name: 'set_surface_style',
    description: 'How part surfaces look and export to Roblox: smooth (no studs), studs (classic: studs on top, inlets below), studs_all (studs on every face, like stud-covered brick art), house (the game style: SmoothPlastic + 2022 MaterialVariant + 4 gradient decals per part, free sizes and tilts).',
    input_schema: { type: 'object', properties: { style: { type: 'string', enum: STYLES } }, required: ['style'] },
  },
  {
    name: 'roblox_snap',
    description: 'Clean the whole model up to Roblox rules. mode "studs" (classic): X/Z sizes to whole studs, heights to plate 0.4 / brick-style steps, positions onto the stud grid, rotations to 90°, Plastic material, classic BrickColors. mode "smooth": sizes/positions to a 0.05-stud grid and colors to the nearest BrickColor. Defaults to the model\'s style. Check with a render afterwards.',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['studs', 'smooth'] }, colors: { type: 'boolean', description: 'snap colors to BrickColors (default true)' },
        keep_tilt: { type: 'boolean', description: 'studs mode: parts rotated off the 90° grid (tree branches, roots) keep their angle and position; only sizes snap' },
      },
    },
  },
];

const RENDER_VIEWS_PROP = { type: 'array', items: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'three_quarter'] }, description: 'defaults to all six' };

export const RENDER_TOOL = {
  name: 'render_views',
  description: 'Render the current model from the standard views (front, back, left, right, top, three_quarter) as ONE labeled contact-sheet image so you can compare it against the reference shots. Use this after building and after every round of fixes.',
  input_schema: { type: 'object', properties: { views: RENDER_VIEWS_PROP } },
};

// Tools that use the 3D scan (GLB from TRELLIS / Hunyuan3D, aligned to the model space).
export const SCAN_TOOLS = [
  {
    name: 'polish_model',
    description: 'AUTO 1:1 POLISH. Automatically nudges every part (position, size, tilt) to match the picture (from its matched camera) and the 3D scan (front/back/left/right/top) as closely as possible, keeping only changes that improve the match. Run it after you have built all parts (it refines, it does not add missing parts). fine: true = smaller steps for a final pass.',
    input_schema: { type: 'object', properties: { fine: { type: 'boolean' } } },
  },
  {
    name: 'colors_from_picture',
    description: 'Sets every part that is visible in the picture to its actual color in the picture (median color of the pixels it covers, seen from the picture\'s camera). brickcolors: true snaps to the nearest Roblox BrickColor instead of the exact color.',
    input_schema: { type: 'object', properties: { brickcolors: { type: 'boolean' } } },
  },
  {
    name: 'render_vs_picture',
    description: 'THE 1:1 CHECK. Renders your model from the same camera angle as the original picture (found automatically) and lines it up with the picture: [your picture | model | difference]. RED = in the picture but missing from the model, BLUE = in the model but not in the picture. Returns IoU vs the picture. Use it after every batch of changes; compare details (stud counts, part edges, colors) directly against the picture.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'render_comparison',
    description: 'Render the 3D scan and your model side by side from the SAME cameras (front, back, left, right, top, 3/4). Model tiles are tinted RED where the scan has mass your model lacks (add/extend there) and BLUE where your model has mass the scan lacks (shrink/move/remove). Returns silhouette IoU per view (1.0 = perfect). Best tool for checking proportions.',
    input_schema: { type: 'object', properties: { views: RENDER_VIEWS_PROP } },
  },
  {
    name: 'mesh_slices',
    description: 'Measure the 3D scan: cuts it into slabs along an axis and lists each solid blob\'s extents in studs plus its main color. E.g. axis "y" gives leg/torso/neck footprints by height; axis "x" gives side-profile pieces. Use the numbers to place and size parts precisely.',
    input_schema: {
      type: 'object',
      properties: {
        axis: { type: 'string', enum: ['x', 'y', 'z'], description: 'default y' },
        count: { type: 'number', description: 'number of slabs (default 16, max 40)' },
      },
    },
  },
  {
    name: 'tree_skeleton',
    description: 'TREE MODE. Analyzes the 3D scan of a tree: splits it into wood (trunk, branches, roots — found by the color of the trunk base, any palette) and canopy, and returns the trunk axis per height, trunk sections (stacked boxes), branch segments (start/end/thickness + a ready rotated box), canopy clusters (bounding boxes + fill + color) and accents (flowers/fruit). add: true also places a draft of those boxes in a "Tree" group.',
    input_schema: {
      type: 'object',
      properties: {
        res: { type: 'number', description: 'voxels along the longest side (24–64, default 48)' },
        clusters: { type: 'number', description: 'force this many canopy clusters (default: automatic)' },
        add: { type: 'boolean', description: 'also add the draft boxes to the model (group "Tree")' },
      },
    },
  },
  {
    name: 'tree_template',
    description: 'HOUSE-STYLE TREES. The game\'s 50 hand-made trees (training/studio-trees) as templates. Without file: lists them (size, part count, colors). With file: outlines that tree (groups, parts, sizes, rotations, variants) so you can copy its construction. add: true imports it into the model scaled to `height` (default: the 3D scan\'s height, else its own size) as a starting point; then reshape it to the picture.',
    input_schema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'template file or name from the list, e.g. "blue_tree"' },
        add: { type: 'boolean', description: 'import it into the model (group "Template_<name>")' },
        height: { type: 'number', description: 'target height in studs for add (default: scan height)' },
      },
    },
  },
  {
    name: 'blockify_mesh',
    description: 'Automatically convert the 3D scan into colored voxel blocks (greedy-merged boxes) inside a new group "Blockout". Fast, accurate silhouette but not clean/intentional. Use as a starting point or reference you then replace with clean parts (delete the Blockout group when done), or keep at low resolution for a voxel look.',
    input_schema: {
      type: 'object',
      properties: {
        res: { type: 'number', description: 'voxels along the longest side (6–48, default 16)' },
        colors: { type: 'number', description: 'palette size (default 8)' },
      },
    },
  },
];

// Runs a MODEL_TOOLS tool. Returns a text result. Throws on invalid input.
export function runModelTool(store, name, input = {}) {
  const ok = (r) => JSON.stringify(r);
  // Lists sent as JSON text, or a single object instead of a list.
  const list = (v) => {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = v.split(',').map((s) => s.trim()).filter(Boolean); } }
    return v && !Array.isArray(v) ? [v] : v;
  };
  input = { ...input };
  for (const k of ['parts', 'updates', 'ids']) if (input[k] !== undefined) input[k] = list(input[k]);
  switch (name) {
    case 'get_model': return store.describe();
    case 'add_parts': return ok(store.exec({ op: 'add_parts', parts: input.parts }, 'tool'));
    case 'update_parts': return ok(store.exec({ op: 'update_parts', updates: input.updates }, 'tool'));
    case 'delete_parts': return ok(store.exec({ op: 'delete_parts', ids: input.ids }, 'tool'));
    case 'mirror_part': return ok(store.exec({ op: 'mirror_part', id: input.id, axis: input.axis }, 'tool'));
    case 'duplicate_part': return ok(store.exec({ op: 'duplicate_part', id: input.id, offset: input.offset }, 'tool'));
    case 'clear_model': return ok(store.exec({ op: 'clear_model', name: input.name }, 'tool'));
    case 'set_surface_style': return ok(store.exec({ op: 'set_style', style: input.style }, 'tool'));
    case 'roblox_snap': return ok(store.exec({ op: 'roblox_snap', mode: input.mode, colors: input.colors, keep_tilt: input.keep_tilt }, 'tool'));
    default: throw new Error(`Unknown tool ${name}`);
  }
}
