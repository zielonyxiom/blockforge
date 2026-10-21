// The AI pipeline:
//   1. references  — GPT-Image makes a 3/4 hero shot, then front/back/left/right/top from it
//   2. plan        — Claude looks at the references and decides which parts need detail shots
//   3. parts       — GPT-Image makes a close-up detail reference for each part
//   4. build       — Claude builds the model with editor tools, renders it, compares, iterates
import fs from 'node:fs';
import path from 'node:path';
import { generateImage, editImage, mimeOf, imageModelName, canEditImages } from './images.js';
import { imageBlock } from './claude.js';
import { chat, llmReady, llmName, isFreeProvider } from './llm.js';
import { generateMesh, MESH_BACKENDS } from './mesh3d.js';
import { MODEL_TOOLS, RENDER_TOOL, SCAN_TOOLS } from './model.js';
import { config, STYLE_DIR } from './config.js';
import { ROBLOX_RULES, presetOf, DEFAULT_PRESET } from './roblox.js';
import {
  DEFAULT_STYLE, REFERENCE_VIEWS, heroPrompt, viewPrompt, partPrompt,
  PLANNER_SYSTEM, PLAN_TOOL, BUILDER_SYSTEM, SCAN_GUIDE, BUDGET_RULES, PICTURE_RULES, FINISH_TOOL, reviewMessage, STYLE_LEARNER_SYSTEM,
  ORIENT_SYSTEM, ORIENT_TOOL, TREE_RULES, isTreeSubject,
} from './prompts.js';

const dataUrlBuf = (d) => Buffer.from(d.split(',')[1], 'base64');

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'item';

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// Image style: the Roblox preset's style, or (preset "custom") style/style-prompt.md.
export function getStyle(presetId) {
  const preset = presetOf(presetId);
  if (preset.image) return preset.image;
  const f = path.join(STYLE_DIR, 'style-prompt.md');
  if (fs.existsSync(f)) {
    const t = fs.readFileSync(f, 'utf8').trim();
    if (t) return t;
  }
  return DEFAULT_STYLE;
}
const presetId = (ctx) => ctx.meta().preset || DEFAULT_PRESET;
const robloxRules = (ctx) => `${ROBLOX_RULES}\n\n${presetOf(presetId(ctx)).rules}`.trim();

// ---- Step 1: main reference shots ----------------------------------------
export async function generateReferences(ctx, subject, signal) {
  const style = getStyle(presetId(ctx));
  ctx.log('info', `Style preset: ${presetOf(presetId(ctx)).label}`);
  ctx.log('info', `Generating 3/4 main reference with ${imageModelName()}…`);
  const hero = await generateImage({ prompt: heroPrompt(subject, style), signal });
  ctx.saveRef('view_three_quarter.png', hero, { kind: 'view', label: '3/4 view', view: 'three_quarter' });

  if (!canEditImages()) {
    ctx.log('info', `${imageModelName()} can only make new images (no image-to-image), so only the main view is generated — the 3D scan gives the consistent front/side/top views.`);
    return;
  }
  const others = REFERENCE_VIEWS.filter((v) => v !== 'three_quarter');
  ctx.log('info', `Generating ${others.join(', ')} views from the main reference…`);
  await mapLimit(others, 5, async (view) => {
    try {
      const img = await editImage({ prompt: viewPrompt(subject, view, style), images: [hero], signal });
      ctx.saveRef(`view_${view}.png`, img, { kind: 'view', label: `${view} view`, view });
    } catch (e) {
      if (signal?.aborted) throw e;
      ctx.log('error', `${view} view failed: ${e.message}`);
    }
  });
}

// ---- Step 2: plan ----------------------------------------------------------
export async function planParts(ctx, subject, signal) {
  const refs = ctx.loadRefs((r) => r.kind === 'view' || r.kind === 'user');
  if (!refs.length) throw new Error('No reference images yet — generate or upload some first.');
  ctx.log('info', `${llmName()} is planning the build…`);
  const content = [{ type: 'text', text: `Model to rebuild: ${subject}` }];
  for (const r of refs) content.push({ type: 'text', text: `Reference: ${r.label}` }, imageBlock(r.buf, mimeOf(r.buf)));
  const resp = await chat({
    system: `${PLANNER_SYSTEM}\n\n${robloxRules(ctx)}`,
    messages: [{ role: 'user', content }],
    tools: [PLAN_TOOL],
    tool_choice: { type: 'tool', name: 'submit_plan' },
    max_tokens: 4000,
    signal,
  });
  const plan = resp.content.find((b) => b.type === 'tool_use')?.input;
  if (!plan) throw new Error('Claude did not return a plan');
  ctx.savePlan(plan);
  ctx.log('claude', `Plan: ${plan.summary}\nParts: ${plan.parts.map((p) => p.name).join(', ')}\nSize: ${plan.dimensions.width_x} × ${plan.dimensions.height_y} × ${plan.dimensions.length_z} studs`);
  return plan;
}

// ---- Step 3: part detail shots -------------------------------------------
export async function generatePartRefs(ctx, subject, parts, signal) {
  const style = getStyle(presetId(ctx));
  const views = ctx.loadRefs((r) => r.kind === 'view');
  const order = ['three_quarter', 'front', 'left', 'back'];
  const inputs = order.map((v) => views.find((r) => r.view === v)).filter(Boolean).map((r) => r.buf);
  if (!inputs.length) throw new Error('Part shots need the main view references first.');
  ctx.log('info', `Generating detail shots: ${parts.map((p) => p.name).join(', ')}…`);
  await mapLimit(parts, 3, async (part) => {
    try {
      const img = await editImage({ prompt: partPrompt(subject, part, style), images: inputs, signal });
      ctx.saveRef(`part_${slugify(part.name)}.png`, img, { kind: 'part', label: `${part.name} detail`, description: part.description });
    } catch (e) {
      if (signal?.aborted) throw e;
      ctx.log('error', `${part.name} detail failed: ${e.message}`);
    }
  });
}

// ---- Step 3b: 3D scan (image → 3D on Hugging Face) --------------------------
// `backend` overrides the MESH_BACKEND setting for this one scan.
export async function generateScan(ctx, signal, { backend = config.MESH_BACKEND } = {}) {
  if (!MESH_BACKENDS.includes(backend)) throw new Error(`Unknown 3D scan backend "${backend}" (use ${MESH_BACKENDS.join(', ')})`);
  const refs = ctx.loadRefs(() => true);
  const pick = refs.find((r) => r.view === 'three_quarter') || refs.find((r) => r.view === 'front') || refs[0];
  if (!pick) throw new Error('The 3D scan needs a reference image first (generate or upload one).');
  ctx.log('info', `Turning "${pick.label}" into a 3D model with ${backend} on Hugging Face…`);
  let cutout = null;
  const glb = await generateMesh(pick.buf, { backend, signal, log: ctx.log, onCutout: (b) => { cutout = b; } });
  ctx.saveMesh(glb, { source: backend, yaw: 0, cutout: cutout ? ctx.saveProjectFile('cutout.png', cutout) : null });
  // Orientation is a nice-to-have: never let it fail the scan.
  try { await orientScan(ctx, signal); }
  catch (e) {
    if (signal?.aborted) throw e;
    ctx.log('info', `Auto-orient skipped (${e.message.slice(0, 120)}). Check the scan faces front; use ⟳ 90° if not.`);
  }
  const sheet = await ctx.requestBrowser('mesh_render');
  ctx.log('image', '3D scan (aligned to the editor: front = +Z)', sheet.image);
}

// Pick the scan's facing direction. First a free local match (silhouette + colors of
// the background-free picture vs the scan at 4 rotations); the AI is only a fallback.
export async function orientScan(ctx, signal) {
  const m = ctx.meta().mesh;
  if (m?.cutout) {
    try {
      const r = await ctx.requestBrowser('auto_orient', { url: ctx.projectFileUrl(m.cutout) });
      ctx.setMeshTransform({ yaw: r.yaw });
      ctx.log('info', `Scan orientation: yaw ${r.yaw}° (picture match ${r.scores.map((s) => `${s.yaw}°=${s.score.toFixed(2)}`).join(', ')}).`);
      return;
    } catch (e) { ctx.log('info', `Local auto-orient failed (${e.message}); asking the AI instead.`); }
  }
  const front = ctx.loadRefs((r) => r.view === 'front')[0] || ctx.loadRefs((r) => r.view === 'three_quarter')[0] || ctx.loadRefs(() => true)[0];
  if (!llmReady() || !front) {
    ctx.log('info', 'Check the scan orientation in the viewport (front should face +Z / the "Front" camera); use ⟳ 90° to fix it.');
    return;
  }
  const yaw = await ctx.requestBrowser('yaw_sheet');
  const resp = await chat({
    system: ORIENT_SYSTEM,
    messages: [{ role: 'user', content: [
      { type: 'text', text: `Reference (${front.label}):` }, imageBlock(front.buf, mimeOf(front.buf)),
      { type: 'text', text: 'The 3D scan rendered from the FRONT camera at four rotations:' }, imageBlock(dataUrlBuf(yaw.image), 'image/jpeg'),
    ] }],
    tools: [ORIENT_TOOL],
    tool_choice: { type: 'tool', name: ORIENT_TOOL.name },
    max_tokens: 600,
    signal,
  });
  const pickOpt = resp.content.find((b) => b.type === 'tool_use')?.input;
  const deg = { A: 0, B: 90, C: 180, D: 270 }[pickOpt?.option] ?? 0;
  ctx.setMeshTransform({ yaw: deg });
  ctx.log('claude', `Scan orientation: yaw ${deg}° — ${pickOpt?.reason || ''}`);
}

// ---- Step 4: Claude builds the model ---------------------------------------
function pruneOldRenders(messages, keep = 2) {
  const slots = [];
  for (let m = 1; m < messages.length; m++) {
    const msg = messages[m];
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        block.content.forEach((c, i) => { if (c.type === 'image') slots.push([block.content, i]); });
      }
    }
  }
  for (const [arr, i] of slots.slice(0, Math.max(0, slots.length - keep))) {
    arr[i] = { type: 'text', text: '[older render removed to save context]' };
  }
}

export async function buildModel(ctx, { subject, notes, reviewRounds = 2, signal }) {
  const refs = ctx.loadRefs(() => true);
  if (!refs.length) throw new Error('No reference images — generate or upload references first.');
  const plan = ctx.meta().plan;

  const intro = [
    `Rebuild this model in the editor: **${subject || ctx.meta().name}**`,
    plan ? `Build plan (from an earlier analysis of the references):\n${JSON.stringify(plan, null, 1)}` : '',
    notes ? `Extra instructions from the user: ${notes}` : '',
    ctx.store.model.parts.length
      ? `The editor already contains a model:\n${ctx.store.describe()}\nRefine it to match the references (or clear_model and rebuild if it is far off).`
      : 'The editor is empty.',
    'Reference images follow.',
  ].filter(Boolean).join('\n\n');

  const content = [{ type: 'text', text: intro }];
  for (const r of refs) {
    content.push({ type: 'text', text: `Reference — ${r.label}${r.description ? `: ${r.description}` : ''}` });
    content.push(imageBlock(r.buf, mimeOf(r.buf)));
  }

  // A 3D scan gives exact proportions: show it and hand Claude the scan tools.
  const scan = ctx.hasMesh();
  if (scan) {
    try {
      const sheet = await ctx.requestBrowser('mesh_render');
      const m = ctx.meta().mesh;
      content.push({ type: 'text', text: `3D SCAN of the reference (${m.source}), already aligned to the editor: stands on y=0, faces +Z, ${m.height} studs tall. Rendered with the SAME cameras as render_views:` });
      content.push(imageBlock(dataUrlBuf(sheet.image), 'image/jpeg'));
    } catch (e) {
      ctx.log('error', `Could not render the 3D scan: ${e.message}`);
    }
  }
  content[content.length - 1].cache_control = { type: 'ephemeral' };

  const tools = [...MODEL_TOOLS, RENDER_TOOL, ...(scan ? SCAN_TOOLS : []), FINISH_TOOL];
  tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } };
  const budget = isFreeProvider();
  const tree = scan && isTreeSubject(`${subject || ''} ${ctx.meta().name || ''}`);
  const system = [{ type: 'text', text: `${BUILDER_SYSTEM}\n\n${robloxRules(ctx)}${scan ? '\n\n' + SCAN_GUIDE : ''}${ctx.meta().mesh?.cutout ? '\n\n' + PICTURE_RULES : ''}${tree ? '\n\n' + TREE_RULES : ''}${budget ? '\n\n' + BUDGET_RULES : ''}`, cache_control: { type: 'ephemeral' } }];
  const preset = presetOf(presetId(ctx));
  if (ctx.store.model.style !== preset.modelStyle && !(preset.modelStyle === 'studs' && ctx.store.model.style === 'studs_all')) ctx.store.exec({ op: 'set_style', style: preset.modelStyle }, 'tool');
  const messages = [{ role: 'user', content }];

  let reviewsLeft = reviewRounds;
  let nudges = 0;
  let lastRender = null; // model state at the last render, to stop repeat renders
  const maxTurns = budget ? (Number(config.LLM_MAX_TURNS) || 18) : (Number(config.CLAUDE_MAX_TURNS) || 60);
  ctx.log('info', `${llmName()} is building the model with ${refs.length} reference image(s)${scan ? ' + 3D scan' : ''}, ${reviewRounds} review round(s)…`);

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (signal?.aborted) throw new Error('Stopped');
    const resp = await chat({ system, messages, tools, max_tokens: 16000, signal });
    messages.push({ role: 'assistant', content: resp.content });

    for (const b of resp.content) if (b.type === 'text' && b.text.trim()) ctx.log('claude', b.text.trim());
    const uses = resp.content.filter((b) => b.type === 'tool_use');

    if (!uses.length) {
      if (resp.stop_reason === 'max_tokens' || nudges < (budget ? 1 : 2)) {
        nudges++;
        messages.push({ role: 'user', content: 'Continue working with the tools. Call finish when the model matches the references.' });
        continue;
      }
      break;
    }

    const results = [];
    let finished = false;
    for (const tu of uses) {
      try {
        if (tu.name === 'finish' && reviewsLeft > 0) {
          // Review round: render (scan comparison when available) and ask for fixes.
          const out = await ctx.runTool(ctx.meta().mesh?.cutout ? 'render_vs_picture' : scan ? 'render_comparison' : 'render_views');
          lastRender = JSON.stringify(ctx.store.model.parts);
          ctx.log('image', `Review render${scan ? ' — ' + (out.text.match(/IoU:[^(]*\(avg [\d.]+\)/)?.[0] || '') : ''}`,`data:image/jpeg;base64,${out.image.toString('base64')}`);
          const text = `${out.text}\n\n${reviewMessage(--reviewsLeft)}`;
          ctx.log('info', `Review round (${reviewsLeft} left after this)…`);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: [imageBlock(out.image, 'image/jpeg'), { type: 'text', text }] });
        } else if (tu.name === 'finish') {
          finished = true;
          ctx.log('claude', `✔ ${tu.input?.summary || 'Finished.'}`);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Done.' });
        } else if (['render_views', 'render_comparison', 'render_vs_picture'].includes(tu.name) && lastRender === JSON.stringify(ctx.store.model.parts)) {
          // Nothing changed since the last render: don't spend a request on the same picture.
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Nothing changed since your last render, so it would look identical. Make your fixes with add_parts / update_parts / delete_parts first, or call finish if it already matches.' });
        } else {
          const out = await ctx.runTool(tu.name, tu.input);
          if (out.image) lastRender = JSON.stringify(ctx.store.model.parts);
          if (out.image) {
            ctx.log('image', `${tu.name}${out.text ? ' — ' + out.text.slice(0, 160) : ''}`, `data:image/jpeg;base64,${out.image.toString('base64')}`);
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: [imageBlock(out.image, 'image/jpeg'), { type: 'text', text: out.text }] });
          } else {
            ctx.log('tool', `${tu.name} → ${out.text.length > 300 ? out.text.slice(0, 300) + '…' : out.text}`);
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.text });
          }
        }
      } catch (e) {
        ctx.log('error', `${tu.name}: ${e.message}`);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
    pruneOldRenders(messages);
    if (finished) return;
  }
  ctx.log('info', `Build stopped after ${maxTurns} turns (the limit${budget ? ' for free models, where each turn is one request' : ''}). Click "5. Build / Refine" to keep improving it.`);
}

// ---- Full pipeline ----------------------------------------------------------
export async function runPipeline(ctx, opts) {
  const { subject, steps = {}, reviewRounds = 2, notes, signal } = opts;
  const s = { references: true, mesh: true, parts: true, build: true, ...steps };
  if (!subject && (s.references || s.parts)) throw new Error('Enter what to make (e.g. "Undead Skeleton Horse").');

  if (s.references) await generateReferences(ctx, subject, signal);
  if (!llmReady() && (s.parts || s.build)) {
    ctx.log('info', 'No AI brain key: skipping plan / part shots / build. Add a free Gemini key in Settings (AI brain), or open Claude Code and say: "Use blockforge to build the current project from its references, following get_build_guide."');
    s.parts = false; s.build = false;
  }
  // The plan gives the target size (used to scale the scan) and the part list.
  let plan = ctx.meta().plan;
  if (s.parts && !canEditImages()) { ctx.log('info', `${imageModelName()} can't edit images, so no part close-ups — the 3D scan covers the details.`); }
  if (s.parts || (s.mesh && !plan && llmReady())) plan = await planParts(ctx, subject, signal);
  if (s.mesh) {
    try { await generateScan(ctx, signal); }
    catch (e) {
      if (signal?.aborted) throw e;
      ctx.log('error', `3D scan failed, continuing without it: ${e.message}`);
    }
  }
  if (s.parts && canEditImages()) await generatePartRefs(ctx, subject, plan.parts, signal);
  if (s.build) {
    await buildModel(ctx, { subject, notes, reviewRounds, signal });
    // Automatic 1:1 finish: nudge parts toward picture + scan, then take colors from the picture.
    if (ctx.hasMesh()) {
      for (const tool of ['polish_model', 'colors_from_picture']) {
        try {
          if (signal?.aborted) throw new Error('Stopped');
          ctx.log('info', tool === 'polish_model' ? 'Auto-polishing toward the picture + scan…' : 'Taking colors from the picture…');
          ctx.log('info', (await ctx.runTool(tool)).text);
        } catch (e) { if (signal?.aborted) throw e; ctx.log('error', `${tool}: ${e.message}`); }
      }
    }
    try {
      const out = await ctx.runTool('export_roblox');
      ctx.log('info', out.text);
    } catch (e) { ctx.log('error', `Roblox export failed: ${e.message}`); }
  }
  ctx.log('info', 'Pipeline finished.');
}

// ---- Learn a style prompt from example images in /style -------------------
export async function learnStyle(ctx, signal) {
  const files = fs.existsSync(STYLE_DIR)
    ? fs.readdirSync(STYLE_DIR).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f))
    : [];
  if (!files.length) throw new Error(`Put example images of Roblox-style models in the "style" folder first (${STYLE_DIR}).`);
  const content = [];
  let total = 0;
  for (const f of files.slice(0, 40)) {
    const buf = fs.readFileSync(path.join(STYLE_DIR, f));
    if (buf.length > 4.5 * 1024 * 1024 || total + buf.length > 22 * 1024 * 1024) { ctx.log('info', `Skipping ${f} (too large)`); continue; }
    total += buf.length;
    content.push(imageBlock(buf, mimeOf(buf)));
  }
  content.push({ type: 'text', text: `These are ${content.length} example models in the target style. Write the style prompt.` });
  ctx.log('info', `Claude is learning the style from ${content.length - 1} example image(s)…`);
  const resp = await chat({ system: STYLE_LEARNER_SYSTEM, messages: [{ role: 'user', content }], max_tokens: 1500, signal });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  fs.writeFileSync(path.join(STYLE_DIR, 'style-prompt.md'), text + '\n');
  ctx.log('claude', `New style prompt saved:\n${text}`);
  return text;
}
