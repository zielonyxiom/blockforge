// Image → 3D mesh through Hugging Face Spaces (Gradio API).
//   trellis   : trellis-community/TRELLIS   (textured GLB, ~20 s on ZeroGPU)
//   trellis2  : microsoft/TRELLIS.2         (higher resolution, two calls)
//   hunyuan3d : tencent/Hunyuan3D-2         (shape + texture)
//   hunyuan21 : tencent/Hunyuan3D-2.1       (sharper shape + PBR texture; asks for 270 s of
//               ZeroGPU, more than an anonymous user may request — needs an HF token)
//   sam3d     : dev-bjoern/sam3d-objects-mcp (Meta SAM 3 + SAM 3D Objects; the official
//               facebook/sam-3d-objects Space is gated). Segments the object by a text
//               prompt itself, so it gets the original picture, not the cut-out.
// Works anonymously with a small ZeroGPU quota; an HF_TOKEN gives a bigger one.
import { config } from './config.js';
import { mimeOf } from './images.js';
import { comfyMesh } from './comfyui3d.js';

export const MESH_BACKENDS = ['trellis', 'trellis2', 'hunyuan3d', 'hunyuan21', 'sam3d', 'comfyui'];

// ZeroGPU quota errors: "You have exceeded your ZeroGPU runs limit…", "You have exceeded your
// GPU quota (120s requested vs. 31s left). Try again in 13:05:10" (wording varies by Space).
export const isQuotaError = (msg) =>
  /exceeded your (zero)?gpu|zerogpu (runs|quota)|gpu quota|runs limit|try again in \d/i.test(String(msg || ''));

async function connect(space, log) {
  const { Client } = await import('@gradio/client');
  log('info', `Connecting to Hugging Face Space ${space}…`);
  const opts = {
    status_callback: (s) => { if (s.status === 'sleeping' || s.status === 'building') log('info', `Space is ${s.status} — waking it up (can take a minute)…`); },
  };
  if (config.HF_TOKEN?.startsWith('hf_')) opts.token = config.HF_TOKEN;
  return Client.connect(space, opts);
}

// predict() is the reliable path in @gradio/client 2.x. Stop works by abandoning the call.
async function run(client, endpoint, data, { signal }) {
  if (signal?.aborted) throw new Error('Stopped');
  const aborted = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }));
  try {
    const res = await Promise.race([client.predict(endpoint, data), aborted]);
    return res.data;
  } catch (e) {
    if (signal?.aborted) throw new Error('Stopped');
    const msg = e?.message || JSON.stringify(e).slice(0, 300);
    throw new Error(`Space error on ${endpoint}: ${msg}${/quota|GPU|exceeded/i.test(msg) ? ' — add an HF_TOKEN in Settings for more ZeroGPU quota.' : ''}`);
  }
}

// Collect every FileData-looking object with a 3D extension, in order.
function meshFiles(data) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const ref = v.url || v.path || '';
    if (/\.(glb|gltf|obj)(\?|$)/i.test(ref)) out.push(v);
    Object.values(v).forEach(walk);
  };
  walk(data);
  return out;
}

async function download(file) {
  const headers = config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {};
  const res = await fetch(file.url, { headers });
  if (!res.ok) throw new Error(`Could not download mesh (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// Cut the subject out (transparent background) with BRIA RMBG-2.0 on Hugging Face.
// Without this, scans of screenshots keep the ground/baseplate as part of the model.
export async function removeBackground(imageBuf, { signal, log } = {}) {
  const { Client, handle_file } = await import('@gradio/client');
  const opts = config.HF_TOKEN?.startsWith('hf_') ? { token: config.HF_TOKEN } : {};
  const c = await Client.connect('briaai/BRIA-RMBG-2.0', opts);
  const aborted = new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('Stopped')), { once: true }));
  const r = await Promise.race([c.predict('/image', { image: handle_file(new Blob([imageBuf], { type: mimeOf(imageBuf) })) }), aborted]);
  const urls = JSON.stringify(r.data).match(/https?:[^"]+?\.png[^"]*/g) || [];
  if (!urls.length) throw new Error('background remover returned no PNG');
  const res = await fetch(urls.at(-1), { headers: config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {} });
  if (!res.ok) throw new Error(`background remover download ${res.status}`);
  log?.('info', 'Removed the background (BRIA RMBG-2.0).');
  return Buffer.from(await res.arrayBuffer());
}

// onCutout(buf) receives the background-free image (used for auto-orientation).
// extraViews: { back, left, right } pictures for multi-view backends (comfyui with a -mv model).
export async function generateMesh(imageBuf, { backend = config.MESH_BACKEND, signal, log, onCutout, extraViews = {} }) {
  const { handle_file } = await import('@gradio/client');
  const original = imageBuf;
  try { imageBuf = await removeBackground(imageBuf, { signal, log }); onCutout?.(imageBuf); }
  catch (e) {
    if (signal?.aborted) throw e;
    // Out of ZeroGPU quota: TRELLIS would fail too (same per-user quota), so stop here.
    // (the local ComfyUI backend doesn't need the quota, so it goes on with the picture as-is)
    if (isQuotaError(e.message) && backend !== 'comfyui') throw new Error(`Background removal: ${e.message}`);
    log('info', `Background removal skipped (${e.message}); using the image as-is.`);
  }
  if (backend === 'comfyui') return comfyMesh({ front: imageBuf, ...extraViews }, { signal, log });
  const image = handle_file(new Blob([imageBuf], { type: mimeOf(imageBuf) }));
  const t0 = Date.now();
  let files;

  if (backend === 'trellis') {
    const c = await connect(config.TRELLIS_SPACE, log);
    try { await c.predict('/start_session', {}); } catch {}
    log('info', 'TRELLIS is reconstructing the 3D model…');
    const data = await run(c, '/generate_and_extract_glb', {
      image, multiimages: [], seed: 0,
      ss_guidance_strength: 7.5, ss_sampling_steps: 12, slat_guidance_strength: 3, slat_sampling_steps: 12,
      multiimage_algo: 'stochastic', mesh_simplify: 0.9, texture_size: 1024,
    }, { signal, log });
    files = meshFiles(data);
  } else if (backend === 'trellis2') {
    const c = await connect(config.TRELLIS2_SPACE, log);
    try { await c.predict('/start_session', {}); } catch {}
    log('info', 'TRELLIS.2 is reconstructing the 3D model…');
    await run(c, '/image_to_3d', { image, seed: 0, resolution: '1024' }, { signal, log });
    log('info', 'TRELLIS.2 is extracting the textured GLB…');
    const data = await run(c, '/extract_glb', { decimation_target: 100000, texture_size: 1024 }, { signal, log });
    files = meshFiles(data);
  } else if (backend === 'hunyuan3d') {
    const c = await connect(config.HUNYUAN_SPACE, log);
    log('info', 'Hunyuan3D is generating shape + texture…');
    const data = await run(c, '/generation_all', {
      image, steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256,
      check_box_rembg: true, num_chunks: 8000, randomize_seed: true,
    }, { signal, log });
    files = meshFiles(data);
    if (files.length > 1) files = [files[1], ...files]; // second output is the textured mesh
  } else if (backend === 'hunyuan21') {
    const c = await connect(config.HUNYUAN21_SPACE, log);
    log('info', 'Hunyuan3D-2.1 is generating shape + PBR texture (2–4 min)…');
    // Outputs: [white mesh (.obj), textured_mesh.glb, html, stats, seed]
    const data = await run(c, '/generation_all', {
      image, steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256,
      check_box_rembg: true, num_chunks: 8000, randomize_seed: false,
    }, { signal, log });
    files = meshFiles(data);
  } else if (backend === 'sam3d') {
    const c = await connect(config.SAM3D_SPACE, log);
    log('info', `SAM 3D Objects is segmenting "${config.SAM3D_PROMPT}" and reconstructing it…`);
    // Outputs: [object.glb (or a Gaussian-splat .ply fallback), segmentation preview, status text].
    // The Space reports failures ("No 'x' found", tracebacks) in the status text, not as errors.
    const orig = handle_file(new Blob([original], { type: mimeOf(original) }));
    const data = await run(c, '/reconstruct_objects', { image: orig, prompt: config.SAM3D_PROMPT || 'object' }, { signal, log });
    const status = String(data?.[2] || '');
    if (isQuotaError(status)) throw new Error(`Space error: ${status}`);
    files = meshFiles(data);
    if (!files.length) {
      const ply = JSON.stringify(data).match(/\.ply\b/);
      throw new Error(ply
        ? 'SAM 3D returned only a Gaussian-splat PLY (no mesh to voxelize or texture). Try another backend.'
        : `SAM 3D gave no mesh: ${status.replace(/\s+/g, ' ').slice(0, 300) || 'no status'}${/No '/.test(status) ? ' — change SAM3D_PROMPT in Settings (e.g. "object", "tree").' : ''}`);
    }
  } else {
    throw new Error(`Unknown MESH_BACKEND "${backend}" (use ${MESH_BACKENDS.join(', ')})`);
  }

  const glb = files.find((f) => /\.glb/i.test(f.url || f.path));
  if (!glb && files.length) throw new Error(`${backend} returned ${(files[0].path || files[0].url).split(/[?#]/)[0].split('.').pop()} instead of a GLB.`);
  if (!glb?.url) throw new Error('The Space returned no mesh file.');
  const buf = await download(glb);
  log('info', `3D model ready (${(buf.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s via ${backend}).`);
  return buf;
}
