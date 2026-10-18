// Batch import: one project per image in a folder, then a resumable queue that runs the
// 3D scan step (background removal + TRELLIS + auto-orient) until the Hugging Face ZeroGPU
// quota runs out. Building the models stays manual / via Claude Code (MCP), so no AI build here.
// Queue state lives in projects/_batch_queue.json so it survives restarts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECTS_DIR } from './config.js';
import { emptyModel } from './model.js';
import { presetOf } from './roblox.js';
import { slugify } from './pipeline.js';
import { isQuotaError } from './mesh3d.js';

export const QUEUE_FILE = path.join(PROJECTS_DIR, '_batch_queue.json');
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const BATCH_PRESET = 'roblox_studs';
const BATCH_STYLE = 'studs_all';
const MAX_ATTEMPTS = 3; // non-quota failures per image before it is left as "failed"

// Projects deleted since the import drop out of the queue.
export function loadQueue() {
  let q;
  try { q = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch { return { items: [] }; }
  q.items = (q.items || []).filter((i) => fs.existsSync(path.join(PROJECTS_DIR, i.slug)));
  return q;
}
function saveQueue(q) { fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)); }

const retryHint = (msg) => String(msg || '').match(/try again in ([\d:]+)/i)?.[1] || null;

export function queueSummary(q = loadQueue()) {
  const n = (s) => q.items.filter((i) => i.status === s).length;
  const retryable = q.items.filter((i) => i.status === 'pending' || (i.status === 'failed' && (i.attempts || 0) < MAX_ATTEMPTS)).length;
  return { folder: q.folder || null, total: q.items.length, done: n('done'), pending: n('pending'), failed: n('failed'), left: retryable, quota: q.quota || null };
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Hash of every user image already in a project → its slug (so a picture that already has
// a project under another name, e.g. "Fish Tree" made from Icon_00114_, is not imported twice).
function existingImages() {
  const out = new Map();
  for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const refs = path.join(PROJECTS_DIR, d.name, 'refs');
    if (!fs.existsSync(refs)) continue;
    for (const f of fs.readdirSync(refs)) {
      if (f.startsWith('user_') && IMAGE_EXT.test(f)) out.set(sha1(fs.readFileSync(path.join(refs, f))), d.name);
    }
  }
  return out;
}

const hasMesh = (slug) => {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, slug, 'meta.json'), 'utf8'));
    return !!meta.mesh && fs.existsSync(path.join(PROJECTS_DIR, slug, meta.mesh.file));
  } catch { return false; }
};

// Create the projects (files only — the current project is not touched) and fill the queue.
export function importFolder(folder, { log }) {
  folder = path.resolve(String(folder || '').trim().replace(/^"|"$/g, ''));
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`Folder not found: ${folder}`);
  const files = fs.readdirSync(folder).filter((f) => IMAGE_EXT.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) throw new Error(`No .png/.jpg/.webp images in ${folder}`);

  const q = loadQueue();
  q.folder = folder;
  const known = existingImages();
  let created = 0, skipped = 0;
  log('info', `Batch import: ${files.length} image(s) from ${folder}…`);
  for (const file of files) {
    const buf = fs.readFileSync(path.join(folder, file));
    const name = file.replace(/\.\w+$/, '');
    const slug = slugify(name);
    const dir = path.join(PROJECTS_DIR, slug);
    let target = slug;
    if (fs.existsSync(dir)) {
      skipped++;
    } else if (known.has(sha1(buf))) {
      target = known.get(sha1(buf));
      skipped++;
      log('info', `  ${file}: already in project "${target}" — skipped.`);
    } else {
      const ext = path.extname(file).toLowerCase().replace('jpeg', 'jpg');
      const ref = `user_${slugify(name)}${ext}`;
      fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'refs', ref), buf);
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
        name, subject: name, refs: { [ref]: { kind: 'user', label: name, description: '' } },
        plan: null, preset: BATCH_PRESET, createdAt: Date.now(), batch: { source: path.join(folder, file) },
      }, null, 2));
      const model = emptyModel(name, presetOf(BATCH_PRESET).modelStyle);
      model.style = BATCH_STYLE;
      fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(model, null, 2));
      created++;
    }
    let item = q.items.find((i) => i.slug === target);
    if (!item) q.items.push(item = { file, slug: target, status: 'pending', attempts: 0 });
    if (hasMesh(target)) item.status = 'done';
  }
  saveQueue(q);
  const s = queueSummary(q);
  log('info', `Batch import done: ${created} project(s) created, ${skipped} already existed. Scan queue: ${s.done} scanned, ${s.left} still need a 3D scan.`);
  return { created, skipped, ...s };
}

// Run the scan step for queued projects until the quota error appears (or the queue is empty).
// deps: { openProject(slug), currentSlug(), scan(signal), log }
export async function runScanQueue(deps, { signal, max = Infinity } = {}) {
  const { openProject, currentSlug, scan, log } = deps;
  const q = loadQueue();
  for (const it of q.items) if (it.status !== 'done' && hasMesh(it.slug)) it.status = 'done';
  const todo = [
    ...q.items.filter((i) => i.status === 'pending'),
    ...q.items.filter((i) => i.status === 'failed' && (i.attempts || 0) < MAX_ATTEMPTS),
  ];
  saveQueue(q);
  if (!todo.length) { log('info', `Batch scans: nothing left to scan (${queueSummary(q).done} done).`); return queueSummary(q); }

  const home = currentSlug();
  let scanned = 0, failedInARow = 0, stopReason = null;
  log('info', `Batch scans: ${todo.length} project(s) queued${Number.isFinite(max) ? ` (this run: at most ${max})` : ''}. Stops cleanly when the Hugging Face GPU quota runs out.`);
  try {
    for (const [idx, item] of todo.entries()) {
      if (signal?.aborted) { stopReason = 'stopped'; break; }
      if (scanned >= max) { stopReason = 'limit'; break; }
      log('info', `Batch scan ${idx + 1}/${todo.length}: ${item.slug}`);
      openProject(item.slug);
      await new Promise((r) => setTimeout(r, 500)); // let the editor switch project first
      try {
        await scan(signal);
        Object.assign(item, { status: 'done', scannedAt: Date.now(), error: undefined });
        scanned++; failedInARow = 0;
      } catch (e) {
        if (signal?.aborted) { stopReason = 'stopped'; break; }
        if (isQuotaError(e.message)) {
          q.quota = { at: Date.now(), message: e.message.slice(0, 300), retryIn: retryHint(e.message) };
          if (item.status === 'failed') item.status = 'pending'; // not this image's fault
          stopReason = 'quota';
          break;
        }
        if (hasMesh(item.slug)) { // the scan itself was saved; only orient / preview failed
          Object.assign(item, { status: 'done', scannedAt: Date.now(), error: `after scan: ${e.message.slice(0, 200)}` });
          scanned++; failedInARow = 0;
          log('info', `  ${item.slug}: scan saved, but a follow-up step failed (${e.message.slice(0, 120)}).`);
        } else {
          Object.assign(item, { status: 'failed', attempts: (item.attempts || 0) + 1, error: e.message.slice(0, 300) });
          log('error', `  ${item.slug}: scan failed (attempt ${item.attempts}/${MAX_ATTEMPTS}): ${e.message.slice(0, 200)}`);
          if (++failedInARow >= 3) { stopReason = 'errors'; break; }
        }
      } finally {
        saveQueue(q);
      }
    }
  } finally {
    saveQueue(q);
    if (home && currentSlug() !== home && fs.existsSync(path.join(PROJECTS_DIR, home))) openProject(home);
  }

  const s = queueSummary(q);
  const tail = `${scanned} scanned this run · ${s.done}/${s.total} done · ${s.left} still need a scan${s.failed ? ` (${s.failed} failed so far)` : ''}.`;
  if (stopReason === 'quota') {
    const hf = q.quota.message.replace(/^[^:]*?: /, '').split(/(?<=\.)\s/)[0];
    log('error', `Batch scans paused: Hugging Face ZeroGPU quota used up${q.quota.retryIn ? ` (try again in ${q.quota.retryIn})` : ''} — "${hf}" ${tail} Click "Resume scans" in Projects later (the free quota refills daily).`);
  } else if (stopReason === 'errors') {
    log('error', `Batch scans paused after 3 failures in a row (the Space may be down). ${tail} Click "Resume scans" in Projects to retry.`);
  } else if (stopReason === 'stopped') {
    log('info', `Batch scans stopped. ${tail}`);
  } else if (stopReason === 'limit') {
    log('info', `Batch scans: run limit reached. ${tail}`);
  } else {
    if (s.left === 0) { delete q.quota; saveQueue(q); }
    log('info', `Batch scans: went through the queue. ${tail}${s.left ? ' Failed ones are retried on "Resume scans".' : ''}`);
  }
  return { ...s, scanned, stopReason };
}
