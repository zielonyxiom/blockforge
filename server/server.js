// BlockForge local server: static editor, model command API, SSE live updates,
// browser-side rendering bridge, project storage and the AI pipeline.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PROJECTS_DIR, STYLE_DIR, config, loadConfig, saveConfig, publicConfig, setNotifier } from './config.js';
import { ModelStore, emptyModel, MODEL_TOOLS, RENDER_TOOL, SCAN_TOOLS, runModelTool } from './model.js';
import { runPipeline, generateReferences, planParts, generatePartRefs, generateScan, orientScan, buildModel, learnStyle, getStyle, slugify } from './pipeline.js';
import { REFERENCE_VIEWS } from './prompts.js';
import { PRESETS, DEFAULT_PRESET, presetOf, nearestBrickColor } from './roblox.js';
import { llmReady, llmName, listModels, PROVIDERS } from './llm.js';
import { imageModelName, canEditImages } from './images.js';
import { importFolder, runScanQueue, queueSummary } from './batch.js';
import { treeIndex, loadTemplate, closestTrees, templateParts } from './templates.js';

loadConfig();
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(STYLE_DIR, { recursive: true });

const PUBLIC_DIR = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Live clients (Server-Sent Events)
// ---------------------------------------------------------------------------
const clients = new Set();
const BOOT_ID = Date.now().toString(36);
function broadcast(type, data) {
  const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const res of clients) res.write(msg);
}

const logs = [];
setNotifier((kind, text) => log(kind, text));
function log(kind, text, image) {
  const entry = { kind, text, image, time: Date.now() };
  logs.push(entry);
  if (logs.length > 300) logs.shift();
  broadcast('log', entry);
  if (kind !== 'image') console.log(`[${kind}] ${String(text).split('\n')[0].slice(0, 160)}`);
}

// ---------------------------------------------------------------------------
// Project storage: projects/<slug>/{model.json, meta.json, refs/*}
// ---------------------------------------------------------------------------
const store = new ModelStore();
let project = null; // { slug, dir, meta }

function projectPaths(slug) {
  const dir = path.join(PROJECTS_DIR, slug);
  return { dir, refs: path.join(dir, 'refs'), model: path.join(dir, 'model.json'), meta: path.join(dir, 'meta.json') };
}

function openProject(name, { create = false } = {}) {
  const slug = slugify(name);
  const p = projectPaths(slug);
  if (!fs.existsSync(p.dir)) {
    if (!create) throw new Error(`Project "${name}" not found`);
    fs.mkdirSync(p.refs, { recursive: true });
    fs.writeFileSync(p.meta, JSON.stringify({ name, subject: name === 'untitled' ? '' : name, refs: {}, plan: null, preset: DEFAULT_PRESET, createdAt: Date.now() }, null, 2));
    fs.writeFileSync(p.model, JSON.stringify(emptyModel(name, presetOf(DEFAULT_PRESET).modelStyle), null, 2));
  }
  fs.mkdirSync(p.refs, { recursive: true });
  const meta = fs.existsSync(p.meta) ? JSON.parse(fs.readFileSync(p.meta, 'utf8')) : { name, refs: {} };
  meta.refs ||= {};
  project = { slug, dir: p.dir, meta };
  const model = fs.existsSync(p.model) ? JSON.parse(fs.readFileSync(p.model, 'utf8')) : emptyModel(name);
  store.model = model;
  store.past = [];
  store.future = [];
  broadcast('project', { project: projectInfo(), model: store.model, refs: listRefs() });
  return project;
}

function saveMeta() { fs.writeFileSync(projectPaths(project.slug).meta, JSON.stringify(project.meta, null, 2)); }

let saveTimer = null;
store.onChange((model, source) => {
  broadcast('model', { model, source, canUndo: store.past.length > 0, canRedo: store.future.length > 0 });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (project) fs.writeFileSync(projectPaths(project.slug).model, JSON.stringify(store.model, null, 2));
  }, 300);
});

function listProjects() {
  return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const mp = path.join(PROJECTS_DIR, d.name, 'meta.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch {}
    const refsDir = path.join(PROJECTS_DIR, d.name, 'refs');
    // Thumbnail: the generated 3/4 view, else the user's own picture (e.g. batch imports).
    const own = !fs.existsSync(path.join(refsDir, 'view_three_quarter.png')) && fs.existsSync(refsDir)
      ? fs.readdirSync(refsDir).find((f) => f.startsWith('user_') && /\.(png|jpe?g|webp)$/i.test(f)) : null;
    const thumb = fs.existsSync(path.join(refsDir, 'view_three_quarter.png')) ? `/projects/${d.name}/refs/view_three_quarter.png`
      : own ? `/projects/${d.name}/refs/${own}` : null;
    return { slug: d.name, name: meta.name || d.name, subject: meta.subject || '', thumb, mtime: fs.statSync(path.join(PROJECTS_DIR, d.name)).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
}

function listRefs() {
  if (!project) return [];
  const dir = projectPaths(project.slug).refs;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  const order = (f) => {
    const v = REFERENCE_VIEWS.findIndex((x) => f === `view_${x}.png`);
    return v >= 0 ? v : f.startsWith('part_') ? 10 : 20;
  };
  return files.sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((file) => {
    const info = project.meta.refs[file] || { kind: 'user', label: file.replace(/\.\w+$/, '') };
    const mtime = fs.statSync(path.join(dir, file)).mtimeMs;
    return { file, ...info, url: `/projects/${project.slug}/refs/${file}?v=${Math.round(mtime)}` };
  });
}

function meshInfo() {
  const m = project?.meta.mesh;
  if (!m) return null;
  const file = path.join(projectPaths(project.slug).dir, m.file);
  if (!fs.existsSync(file)) return null;
  return { ...m, url: `/projects/${project.slug}/${m.file}?v=${Math.round(fs.statSync(file).mtimeMs)}` };
}

function aiStatus() {
  return {
    hasOpenAI: !!config.OPENAI_API_KEY, hasLLM: llmReady(), llmName: llmName(), imageName: imageModelName(),
    imageNeedsKey: ({ openai: !config.OPENAI_API_KEY, gemini: !config.GEMINI_API_KEY, huggingface: !config.HF_TOKEN, cloudflare: !(config.CF_ACCOUNT_ID && config.CF_API_TOKEN) })[config.IMAGE_PROVIDER] || false,
    canEditImages: canEditImages(),
    llmProviders: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label })),
  };
}

function projectInfo() {
  return project && {
    slug: project.slug, name: project.meta.name, subject: project.meta.subject || '', plan: project.meta.plan || null, mesh: meshInfo(),
    preset: project.meta.preset || DEFAULT_PRESET,
  };
}

// ---------------------------------------------------------------------------
// Browser bridge: the editor does renders, scan measurements and blockify
// (it has WebGL + the loaded scan) and posts results back.
// ---------------------------------------------------------------------------
const pendingBrowser = new Map();
let browserSeq = 0;
async function requestBrowser(op, args = {}, timeoutMs = 60000) {
  // An editor tab may be reloading (e.g. after a restart): give it a moment to reconnect.
  for (let i = 0; i < 30 && !clients.size; i++) await new Promise((r) => setTimeout(r, 500));
  if (!clients.size) throw new Error('No editor open — open the editor (http://localhost:' + (config.PORT || 5177) + ') in a browser; it does the rendering.');
  const id = String(++browserSeq);
  return new Promise((resolve, reject) => {
    const msg = `data: ${JSON.stringify({ type: 'browser_request', id, op, args })}\n\n`;
    // Only the most recently opened editor tab does the work (old tabs may be stale).
    const newest = [...clients].pop();
    // …but if that connection is dead and stays silent, ask the other tabs too.
    const fallback = setTimeout(() => { for (const c of clients) if (c !== newest) c.write(msg); }, 8000);
    const timer = setTimeout(() => { pendingBrowser.delete(id); clearTimeout(fallback); reject(new Error(`Editor did not answer "${op}" in time (is the editor tab open?)`)); }, timeoutMs);
    pendingBrowser.set(id, {
      resolve: (r) => { clearTimeout(timer); clearTimeout(fallback); resolve(r); },
      reject: (e) => { clearTimeout(timer); clearTimeout(fallback); reject(e); },
    });
    newest.write(msg);
  });
}
async function requestRender(views) {
  const r = await requestBrowser('render', { views: views?.length ? views : null });
  return dataUrlToBuffer(r.image);
}

// The picture's camera (matched once, then cached). Turns the scan so the picture is the front view.
async function pictureCam() {
  const m = project.meta.mesh;
  if (!m?.cutout) return null;
  const url = `/projects/${project.slug}/${m.cutout}`;
  if (!m.photoCam) {
    let cam = await requestBrowser('match_photo', { url });
    for (let round = 0; round < 3 && Math.abs(cam.yaw) > 3; round++) {
      setMeshTransform({ yaw: m.yaw - cam.yaw });
      log('info', `Turned the scan by ${-cam.yaw}° so your picture's view is the front.`);
      await new Promise((r) => setTimeout(r, 300));
      cam = await requestBrowser('match_photo', { url });
    }
    m.photoCam = cam;
    saveMeta();
    log('info', `Matched the picture's camera: yaw ${cam.yaw}°, pitch ${cam.pitch}°, lens ${cam.fov}° (silhouette match ${cam.score}).`);
  }
  return { url, cam: m.photoCam };
}

// Runs any editor tool (model + render + scan). Returns { text, image? }.
async function runTool(name, input = {}) {
  switch (name) {
    case 'render_views':
      return { image: await requestRender(input.views), text: 'Render of the current model (labeled views).' };
    case 'render_comparison': {
      const r = await requestBrowser('compare', { views: input.views?.length ? input.views : null });
      const iou = Object.entries(r.iou).map(([v, n]) => `${v} ${n.toFixed(2)}`).join(', ');
      const avg = Object.values(r.iou).reduce((s, n) => s + n, 0) / Object.keys(r.iou).length;
      return {
        image: dataUrlToBuffer(r.image),
        text: `Scan vs model (same cameras). Silhouette IoU: ${iou} (avg ${avg.toFixed(2)}). RED = scan has mass your model lacks → add/extend there. BLUE = your model has mass the scan lacks → shrink/move/remove.`,
      };
    }
    case 'mesh_slices': {
      const info = await requestBrowser('mesh_info');
      const r = await requestBrowser('slices', { axis: input.axis || 'y', count: Math.min(40, Math.max(2, input.count || 16)) });
      return { text: `Scan bounds: min ${JSON.stringify(info.min)} max ${JSON.stringify(info.max)} size ${JSON.stringify(info.size)}\n${r.text}` };
    }
    case 'blockify_mesh': {
      const res = Math.min(48, Math.max(6, Math.round(input.res || 16)));
      const r = await requestBrowser('blockify', { res, colors: input.colors || 8 }, 120000);
      const group = store.uniqueName('Blockout');
      const parts = [{ kind: 'group', name: group, pivot: [0, 0, 0] },
        ...r.parts.map((p, i) => ({ ...p, name: `${group}_${i + 1}`, parent: group }))];
      store.exec({ op: 'add_parts', parts }, 'tool');
      return { text: `Added ${r.parts.length} blocks in group "${group}" (voxel ${r.voxel} studs, grid ${r.grid.join('×')}, palette ${r.palette.join(' ')}).` };
    }
    case 'tree_skeleton': {
      const res = Math.min(64, Math.max(24, Math.round(input.res || 48)));
      const t = await requestBrowser('tree_skeleton', { res, clusters: Math.max(0, Math.round(input.clusters || 0)) }, 120000);
      const v3 = (a) => `[${a.join(', ')}]`;
      const bc = (h) => `${h} (${nearestBrickColor(h).name})`;
      const lines = [
        `Tree skeleton of the 3D scan (voxel ${t.voxel} studs, grid ${t.grid.join('×')}, height ${t.height} studs). Wood/leaf split by ${t.split === 'color' ? 'color' : 'shape (wood and leaves have the same color)'}: wood ${bc(t.wood_color)}, leaves ${bc(t.leaf_color)}.${t.ground ? ` Ignored a ${t.ground}-stud ground plate under the scan (not part of the tree).` : ''}`,
        `TRUNK AXIS (center x,z per height; visible trunk ends at y ${t.trunk_top}):`,
        ...t.axis.map((a) => `  y ${a.y}: center ${v3(a.center)}, ${a.width} × ${a.depth}`),
        `TRUNK SECTIONS (build each as one box, bottom to top):`,
        ...t.trunk.map((s, i) => `  ${i + 1}. y ${s.min[1]}–${s.max[1]}: position ${v3(s.center)}, size ${v3(s.size)}`),
        `BRANCHES/ROOTS (${t.branches.length}; one rotated box each, Y axis from start to end):`,
        ...t.branches.map((b, i) => `  ${i + 1}. ${b.kind} start ${v3(b.start)} → end ${v3(b.end)}, length ${b.length}, thick ${b.thickness}, tilt ${b.tilt_deg}° → box position ${v3(b.box.position)} size ${v3(b.box.size)} rotation ${v3(b.box.rotation)}`),
        `CANOPY CLUSTERS (${t.canopy.length}; 1–3 boxes each, fill = how box-like it is):`,
        ...t.canopy.map((c, i) => `  ${i + 1}. min ${v3(c.min)} max ${v3(c.max)} → position ${v3(c.center)} size ${v3(c.size)}, fill ${c.fill}, color ${bc(c.color)}`),
        t.accents.length ? `ACCENTS (flowers/fruit/light plates; ${t.accents.length}):` : 'ACCENTS: none found.',
        ...t.accents.map((a) => `  center ${v3(a.center)} size ${v3(a.size)} color ${bc(a.color)}`),
      ];
      const info = await requestBrowser('mesh_info');
      const near = closestTrees({ size: info.size, wood: t.wood_color, leaf: t.leaf_color });
      if (near.length) lines.push(`CLOSEST HOUSE TREES (shape + colors; lower = closer; see tree_template): ${near.map((n) => `${n.file.replace(/\.json$/, '')} (${n.parts} parts, ${n.extents.join('×')}, ${n.colors.slice(0, 3).join(' ')}, score ${n.score})`).join(' · ')}`);
      if (input.add) {
        const g = store.uniqueName('Tree');
        const parts = [{ kind: 'group', name: g, pivot: [0, 0, 0] },
          { kind: 'group', name: `${g}_Trunk`, parent: g, pivot: [0, 0, 0] },
          { kind: 'group', name: `${g}_Branches`, parent: g, pivot: [0, 0, 0] },
          { kind: 'group', name: `${g}_Canopy`, parent: g, pivot: [0, 0, 0] },
          ...t.trunk.map((s, i) => ({ name: `Trunk_${i + 1}`, parent: `${g}_Trunk`, position: s.center, size: s.size, color: t.wood_color })),
          ...t.branches.map((b, i) => ({ name: `${b.kind === 'root' ? 'Root' : 'Branch'}_${i + 1}`, parent: `${g}_Branches`, ...b.box, color: t.wood_color })),
          ...t.canopy.map((c, i) => ({ name: `Canopy_${i + 1}`, parent: `${g}_Canopy`, position: c.center, size: c.size, color: c.color })),
          ...t.accents.map((a, i) => ({ name: `Accent_${i + 1}`, parent: `${g}_Canopy`, position: a.center, size: a.size, color: a.color })),
        ];
        store.exec({ op: 'add_parts', parts }, 'tool');
        lines.push(`Added a draft in group "${g}" (${parts.length - 4} boxes). Refine it against the picture: stud counts, layered canopy slabs, branch angles.`);
      }
      return { text: lines.join('\n') };
    }
    case 'tree_template': {
      if (!input.file) {
        const all = treeIndex();
        if (!all.length) throw new Error('No tree templates: training/studio-trees/index.json is missing.');
        return { text: `House-style tree templates (${all.length}; extents x×y×z studs):\n${all.map((t) => `- ${t.file.replace(/\.json$/, '')}: ${t.parts} parts, ${t.extents.join('×')}, colors ${t.colors.join(' ')}`).join('\n')}` };
      }
      const { entry, model } = loadTemplate(input.file);
      if (input.add) {
        const height = input.height || meshInfo()?.height || undefined;
        const prefix = store.uniqueName(`Template_${entry.file.replace(/\.json$/, '')}`);
        const { parts, scale } = templateParts(model, { height, prefix });
        store.exec({ op: 'add_parts', parts }, 'tool');
        return { text: `Imported ${entry.name} (${entry.parts} parts) as group "${prefix}", scaled ×${scale}${height ? ` to ${height} studs tall` : ''}. Now fit it to the picture: move/resize/re-tilt blobs and trunk segments, delete what the picture doesn't have.` };
      }
      const outline = new ModelStore(model).describe();
      return { text: `Template ${entry.name} (${entry.extents.join('×')} studs, ${entry.parts} parts, colors ${entry.colors.join(' ')}):\n${outline}` };
    }
    case 'render_vs_picture': {
      const pic = await pictureCam();
      if (!pic) throw new Error('render_vs_picture needs a 3D scan made from the picture (it uses the background-free cut-out). Run the 3D scan step first.');
      const r = await requestBrowser('picture_compare', { url: pic.url, cam: pic.cam });
      return {
        image: dataUrlToBuffer(r.image),
        text: `Model vs your picture, same camera. IoU ${r.iou.toFixed(2)} (1.0 = identical silhouette). RED = in the picture but missing from the model → add/extend. BLUE = in the model but not in the picture → shrink/move/remove. Also compare stud counts per face, part edges and colors directly.`,
      };
    }
    case 'polish_model': {
      if (!meshInfo()) throw new Error('polish_model needs a 3D scan (run the 3D scan step first).');
      const pic = await pictureCam();
      const r = await requestBrowser('polish', { pictureUrl: pic?.url, cam: pic?.cam, steps: input.fine ? [0.25, 0.1, 0.05] : [0.5, 0.25, 0.1] }, 600000);
      if (r.updates.length) store.exec({ op: 'update_parts', updates: r.updates }, 'tool');
      const fmt = (v) => Object.entries(v).map(([k, n]) => `${k} ${n.toFixed(2)}`).join(', ');
      return { text: `Auto-polish adjusted ${r.updates.length} parts in ${r.seconds}s. Match ${r.before.score.toFixed(3)} → ${r.after.score.toFixed(3)} (${fmt(r.after.views)}).` };
    }
    case 'colors_from_picture': {
      const pic = await pictureCam();
      if (!pic) throw new Error('colors_from_picture needs a 3D scan made from the picture.');
      const r = await requestBrowser('picture_colors', { pictureUrl: pic.url, cam: pic.cam }, 120000);
      const snap = input.brickcolors === true;
      // Parts the builder gave the same color are one material: give them ONE color, measured
      // from all their visible pixels (keeps the palette clean; hidden/back parts follow along).
      const byId = new Map(store.model.parts.map((p) => [p.id, p]));
      const groups = new Map();
      for (const c of r.colors) {
        const p = byId.get(c.id); if (!p) continue;
        const g = groups.get(p.color) || { w: 0, sum: [0, 0, 0] };
        g.w += c.pixels; c.rgb.forEach((v, i) => (g.sum[i] += v * c.pixels));
        groups.set(p.color, g);
      }
      const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      const updates = [];
      const changes = [];
      const kept = [];
      for (const [oldColor, g] of groups) {
        // Too little of this material is visible to measure reliably (eyes, stripes…): keep the designed color.
        if (g.w < 120) { kept.push(oldColor); continue; }
        let hex = toHex(g.sum.map((v) => v / g.w));
        if (snap) hex = nearestBrickColor(hex).hex;
        changes.push(`${oldColor}→${hex}`);
        for (const p of store.model.parts) if (p.type === 'cube' && p.color === oldColor) updates.push({ id: p.id, color: hex });
      }
      if (updates.length) store.exec({ op: 'update_parts', updates }, 'tool');
      return { text: `Recolored ${updates.length} parts in ${changes.length} color groups from the picture${snap ? ' (snapped to BrickColors)' : ''}: ${changes.join(', ')}.${kept.length ? ` Kept ${kept.join(', ')} (too small to measure).` : ''}` };
    }
    case 'export_roblox': {
      const r = await requestBrowser('export_rbxmx');
      const file = `${slugify(store.model.name || project.meta.name)}.rbxmx`;
      const full = path.join(projectPaths(project.slug).dir, file);
      fs.writeFileSync(full, r.xml);
      return { text: `Exported ${r.parts} Roblox parts to ${full} — drag this file into Roblox Studio (or File → Insert from File).` };
    }
    default:
      return { text: runModelTool(store, name, input) };
  }
}

function saveMesh(buf, info) {
  const file = 'mesh.glb';
  fs.writeFileSync(path.join(projectPaths(project.slug).dir, file), buf);
  project.meta.mesh = {
    file, yaw: 0,
    height: project.meta.plan?.dimensions?.height_y || project.meta.mesh?.height || 5,
    linear: /^trellis/.test(info.source || ''), // TRELLIS bakes linear colors into an sRGB texture
    ...info,
  };
  saveMeta();
  broadcast('project', { project: projectInfo() });
}
function setMeshTransform(t) {
  if (!project.meta.mesh) throw new Error('No 3D scan in this project.');
  if (t.yaw !== undefined) project.meta.mesh.yaw = ((Math.round(t.yaw) % 360) + 360) % 360;
  if (t.height !== undefined) project.meta.mesh.height = Math.max(0.1, Number(t.height));
  if (t.linear !== undefined) project.meta.mesh.linear = !!t.linear;
  if (t.yaw !== undefined || t.height !== undefined) delete project.meta.mesh.photoCam; // re-match next time
  saveMeta();
  broadcast('project', { project: projectInfo() });
  return project.meta.mesh;
}

// ---------------------------------------------------------------------------
// Pipeline context + job runner (one AI job at a time)
// ---------------------------------------------------------------------------
const ctx = {
  store,
  log,
  requestRender,
  requestBrowser,
  runTool,
  saveMesh,
  setMeshTransform,
  hasMesh: () => !!meshInfo(),
  meta: () => project.meta,
  // Extra files in the project folder (e.g. the background-free cut-out). Returns the file name.
  saveProjectFile(name, buf) { fs.writeFileSync(path.join(projectPaths(project.slug).dir, path.basename(name)), buf); return path.basename(name); },
  projectFileUrl(name) { return `/projects/${project.slug}/${path.basename(name)}?v=${Date.now()}`; },
  saveRef(file, buf, info) {
    fs.writeFileSync(path.join(projectPaths(project.slug).refs, file), buf);
    project.meta.refs[file] = info;
    saveMeta();
    log('info', `Saved reference: ${info.label}`);
    broadcast('refs', { refs: listRefs() });
  },
  loadRefs(filter) {
    return listRefs().filter(filter).map((r) => ({ ...r, buf: fs.readFileSync(path.join(projectPaths(project.slug).refs, r.file)) }));
  },
  savePlan(plan) { project.meta.plan = plan; saveMeta(); broadcast('project', { project: projectInfo() }); },
};

let job = null; // { name, abort }
function startJob(name, fn) {
  if (job) throw new Error(`Busy: "${job.name}" is running. Stop it first.`);
  const abort = new AbortController();
  job = { name, abort };
  broadcast('job', { job: name });
  (async () => {
    try { await fn(abort.signal); }
    catch (e) { log('error', abort.signal.aborted ? 'Stopped.' : e.message); }
    finally { job = null; broadcast('job', { job: null }); }
  })();
}

function startBatchScans(max) {
  if (!queueSummary().left) throw new Error('No projects left to scan in the batch queue.');
  startJob('batch scans', (signal) => runScanQueue({
    openProject: (slug) => openProject(slug),
    currentSlug: () => project?.slug,
    scan: (sig) => generateScan(ctx, sig),
    log,
  }, { signal, max: Number(max) > 0 ? Number(max) : Infinity }));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 60e6) throw new Error('Body too large'); chunks.push(c); }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function serveFile(res, base, rel) {
  const file = path.resolve(base, '.' + path.sep + decodeURIComponent(rel));
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Expected a base64 data URL');
  return Buffer.from(m[2], 'base64');
}

const routes = {
  'GET /api/state': () => ({
    project: projectInfo(), model: store.model, refs: listRefs(), logs, job: job?.name || null,
    canUndo: store.past.length > 0, canRedo: store.future.length > 0,
    config: publicConfig(), ...aiStatus(),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })),
  }),
  'GET /api/llm/models': async () => ({ models: await listModels() }),
  'POST /api/projects/preset': (b) => {
    if (!PRESETS[b.preset]) throw new Error(`Unknown preset ${b.preset}`);
    project.meta.preset = b.preset; saveMeta();
    const style = presetOf(b.preset).modelStyle;
    if (store.model.style !== style) store.exec({ op: 'set_style', style }, 'editor');
    broadcast('project', { project: projectInfo() });
    log('info', `Style preset: ${PRESETS[b.preset].label}`);
    return { ok: true };
  },
  'POST /api/export/roblox': async () => {
    const r = await runTool('export_roblox');
    log('info', r.text);
    return { ok: true, text: r.text };
  },
  'POST /api/command': (b) => store.exec(b, b.source || 'editor'),
  'POST /api/undo': () => ({ ok: store.undo() }),
  'POST /api/redo': () => ({ ok: store.redo() }),
  'GET /api/model/describe': () => ({ text: store.describe() }),

  // Generic tool endpoint used by the MCP server.
  'GET /api/tools': () => ({ tools: [...MODEL_TOOLS, RENDER_TOOL, ...SCAN_TOOLS] }),
  'POST /api/tool': async (b) => {
    const r = await runTool(b.name, b.input || {});
    return r.image ? { text: r.text, image: r.image.toString('base64'), mime: 'image/jpeg' } : { text: r.text };
  },

  'POST /api/browser-result': (b) => {
    const p = pendingBrowser.get(String(b.id));
    if (!p) return { ok: false };
    pendingBrowser.delete(String(b.id));
    if (b.error) p.reject(new Error(b.error)); else p.resolve(b.result);
    return { ok: true };
  },

  // 3D scan
  'POST /api/mesh/upload': (b) => {
    const buf = dataUrlToBuffer(b.data);
    if (buf.slice(0, 4).toString() !== 'glTF') throw new Error('Only binary .glb files are supported.');
    saveMesh(buf, { source: `upload: ${b.name || 'mesh.glb'}` });
    log('info', 'Uploaded 3D reference mesh.');
    return { ok: true };
  },
  'POST /api/mesh/delete': () => {
    if (project.meta.mesh) fs.rmSync(path.join(projectPaths(project.slug).dir, project.meta.mesh.file), { force: true });
    delete project.meta.mesh; saveMeta();
    broadcast('project', { project: projectInfo() });
    return { ok: true };
  },
  'POST /api/mesh/transform': (b) => setMeshTransform(b),
  'POST /api/mesh/orient': () => {
    if (!project.meta.mesh?.cutout && !llmReady()) throw new Error('Auto-orient needs the picture cut-out (made during a scan) or an AI brain key — or rotate with ⟳ 90°.');
    startJob('orient scan', (signal) => orientScan(ctx, signal));
    return { ok: true };
  },
  'POST /api/mesh/polish': () => {
    startJob('auto-polish', async () => { log('info', 'Auto-polishing (nudging every part toward the picture + scan)…'); log('info', (await runTool('polish_model')).text); });
    return { ok: true };
  },
  'POST /api/mesh/picture-colors': async () => {
    const r = await runTool('colors_from_picture');
    log('info', r.text);
    return { ok: true };
  },
  'POST /api/mesh/picture-compare': async () => {
    const r = await runTool('render_vs_picture');
    log('image', r.text.match(/^.*?IoU [\d.]+/)?.[0] || 'Model vs picture', `data:image/jpeg;base64,${r.image.toString('base64')}`);
    return { ok: true };
  },
  'POST /api/mesh/compare': async () => {
    const r = await runTool('render_comparison');
    log('image', r.text, `data:image/jpeg;base64,${r.image.toString('base64')}`);
    return { ok: true };
  },
  'POST /api/mesh/blockify': async (b) => {
    const r = await runTool('blockify_mesh', b);
    log('info', r.text);
    return { ok: true };
  },
  'POST /api/pipeline/mesh': () => {
    startJob('3D scan', (signal) => generateScan(ctx, signal));
    return { ok: true };
  },
  'POST /api/gen/mesh': async (b) => { await generateScan(ctx, undefined, { backend: b.backend || undefined }); return { mesh: meshInfo() }; },

  // Projects
  'GET /api/projects': () => ({ projects: listProjects(), current: project?.slug }),
  'POST /api/projects/open': (b) => { openProject(b.slug || b.name); return { ok: true }; },
  'POST /api/projects/new': (b) => {
    const name = String(b.name || '').trim() || 'untitled';
    let slug = slugify(name), i = 2;
    const base = slug;
    while (fs.existsSync(path.join(PROJECTS_DIR, slug))) slug = `${base}_${i++}`;
    openProject(slug, { create: true });
    project.meta.name = name; project.meta.subject = b.subject ?? name;
    if (PRESETS[b.preset]) project.meta.preset = b.preset;
    saveMeta();
    store.exec({ op: 'set_name', name }, 'editor');
    store.exec({ op: 'set_style', style: presetOf(project.meta.preset).modelStyle }, 'editor');
    broadcast('project', { project: projectInfo(), model: store.model, refs: listRefs() });
    return { ok: true, slug };
  },
  // Batch import: one project per image in a folder + a resumable 3D-scan queue (no AI build).
  'GET /api/batch': () => queueSummary(),
  'POST /api/batch/import': (b) => {
    const r = importFolder(b.folder, { log });
    if (b.scan !== false) {
      if (job) log('info', `Scans not started: "${job.name}" is running. Use "Resume scans" in Projects when it is done.`);
      else startBatchScans(b.max);
    }
    return r;
  },
  'POST /api/batch/resume': (b) => { startBatchScans(b.max); return queueSummary(); },
  'POST /api/projects/subject': (b) => { project.meta.subject = String(b.subject || ''); saveMeta(); return { ok: true }; },

  // References
  'GET /api/refs': () => ({ refs: listRefs() }),
  'POST /api/refs/upload': (b) => {
    const buf = dataUrlToBuffer(b.image);
    const ext = /png/.test(b.image.slice(0, 30)) ? 'png' : /webp/.test(b.image.slice(0, 30)) ? 'webp' : 'jpg';
    const label = String(b.label || b.name || 'reference').replace(/\.\w+$/, '');
    const file = `user_${slugify(label)}.${ext}`;
    ctx.saveRef(file, buf, { kind: 'user', label, description: b.description || '' });
    return { ok: true, file };
  },
  'POST /api/refs/delete': (b) => {
    const file = path.basename(String(b.file));
    fs.rmSync(path.join(projectPaths(project.slug).refs, file), { force: true });
    delete project.meta.refs[file]; saveMeta();
    broadcast('refs', { refs: listRefs() });
    return { ok: true };
  },

  // AI jobs
  'POST /api/pipeline/run': (b) => {
    const subject = String(b.subject || project.meta.subject || '').trim();
    if (subject) { project.meta.subject = subject; saveMeta(); }
    startJob('pipeline', (signal) => runPipeline(ctx, { subject, steps: b.steps, reviewRounds: b.reviewRounds ?? 2, notes: b.notes, signal }));
    return { ok: true };
  },
  'POST /api/pipeline/references': (b) => {
    const subject = String(b.subject || project.meta.subject || '').trim();
    if (!subject) throw new Error('Enter what to make first.');
    project.meta.subject = subject; saveMeta();
    startJob('references', (signal) => generateReferences(ctx, subject, signal));
    return { ok: true };
  },
  'POST /api/pipeline/plan': () => {
    startJob('plan', (signal) => planParts(ctx, project.meta.subject, signal));
    return { ok: true };
  },
  'POST /api/pipeline/parts': (b) => {
    const parts = b.parts || project.meta.plan?.parts;
    if (!parts?.length) throw new Error('No part list — run "Plan parts" first.');
    startJob('parts', (signal) => generatePartRefs(ctx, project.meta.subject, parts, signal));
    return { ok: true };
  },
  'POST /api/pipeline/build': (b) => {
    startJob('build', (signal) => buildModel(ctx, { subject: project.meta.subject, notes: b.notes, reviewRounds: b.reviewRounds ?? 2, signal }));
    return { ok: true };
  },
  'POST /api/pipeline/from-image': (b) => {
    if (!listRefs().length) throw new Error('Add your image first (+ Image, or drop it on the viewport).');
    const subject = String(b.subject || project.meta.subject || '').trim() || 'the object in the reference image';
    // Reuse an existing scan (saves Hugging Face GPU quota) unless asked to rescan.
    const mesh = !meshInfo() || !!b.rescan;
    if (!mesh) log('info', 'Using the existing 3D scan (remove it with ✕ in the 3D scan panel to make a new one).');
    startJob('image → model', (signal) => runPipeline(ctx, { subject, steps: { references: false, mesh, parts: false, build: true }, reviewRounds: b.reviewRounds ?? 2, notes: b.notes, signal }));
    return { ok: true };
  },
  'POST /api/pipeline/stop': () => { job?.abort.abort(); return { ok: true }; },

  // Synchronous image tools for the MCP server (Claude Code as the brain).
  'POST /api/gen/references': async (b) => {
    const subject = String(b.subject || project.meta.subject || '').trim();
    if (!subject) throw new Error('subject is required');
    project.meta.subject = subject; saveMeta();
    await generateReferences(ctx, subject);
    return { refs: listRefs() };
  },
  'POST /api/gen/part': async (b) => {
    await generatePartRefs(ctx, project.meta.subject || b.subject || '', [{ name: b.name, description: b.description || b.name }]);
    return { refs: listRefs() };
  },
  'POST /api/refs/read': (b) => {
    const r = listRefs().find((x) => x.file === b.file || x.label === b.file);
    if (!r) throw new Error(`No reference "${b.file}"`);
    return { ...r, image: fs.readFileSync(path.join(projectPaths(project.slug).refs, r.file)).toString('base64') };
  },

  // Style
  'GET /api/style': () => ({
    text: getStyle(project.meta.preset), preset: presetOf(project.meta.preset).label,
    custom: (project.meta.preset === 'custom') && fs.existsSync(path.join(STYLE_DIR, 'style-prompt.md')), folder: STYLE_DIR,
    editable: project.meta.preset === 'custom',
  }),
  'POST /api/style': (b) => {
    const f = path.join(STYLE_DIR, 'style-prompt.md');
    if (b.reset) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, String(b.text || '').trim() + '\n');
    return { ok: true };
  },
  'POST /api/style/learn': () => { startJob('learn style', (signal) => learnStyle(ctx, signal)); return { ok: true }; },

  // Settings
  'POST /api/settings': (b) => {
    const updates = {};
    for (const [k, v] of Object.entries(b)) if (v !== undefined && !(typeof v === 'string' && v.startsWith('set (…'))) updates[k] = v;
    saveConfig(updates);
    return { config: publicConfig(), ...aiStatus() };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      // Tabs compare this id: if the server restarted (new code), they reload themselves.
      res.write(`data: ${JSON.stringify({ type: 'hello', boot: BOOT_ID })}\n\n`);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    const handler = routes[`${req.method} ${p}`];
    if (handler) {
      const body = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
      const out = await handler(body);
      return send(res, 200, out ?? { ok: true });
    }
    if (p.startsWith('/vendor/three/')) return serveFile(res, THREE_DIR, p.slice('/vendor/three/'.length));
    if (p.startsWith('/projects/')) return serveFile(res, PROJECTS_DIR, p.slice('/projects/'.length));
    if (req.method === 'GET') return serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

// Open the most recent project (or create one).
const existing = listProjects();
openProject(existing[0]?.slug || 'untitled', { create: true });

const PORT = Number(config.PORT) || 5177;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  BlockForge running →  http://localhost:${PORT}\n`);
  console.log(`  Images: ${imageModelName()}`);
  console.log(`  Brain:  ${llmName()}${llmReady() ? '' : '  (no key yet — add it under Settings)'}\n`);
});
