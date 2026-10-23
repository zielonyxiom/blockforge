// Local 3D scans through ComfyUI's built-in Hunyuan3D-2 nodes: no Hugging Face quota, runs on
// your own GPU (an 8 GB card is enough for the multi-view turbo model). The node graphs are
// ComfyUI's own templates (3d_hunyuan3d_multiview_to_model_turbo / 3d_hunyuan3d-v2.1), sent
// through its HTTP API. The result is an untextured GLB (shape only).
import { config } from './config.js';

const base = () => (config.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');

async function api(path, init) {
  let res;
  try { res = await fetch(base() + path, init); }
  catch { throw new Error(`ComfyUI is not running at ${base()}. Start it (ComfyUI-Easy-Install → "Start ComfyUI.bat") and try again.`); }
  if (!res.ok) throw new Error(`ComfyUI ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function upload(buf, name) {
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), name);
  form.append('overwrite', 'true');
  const r = await (await api('/upload/image', { method: 'POST', body: form })).json();
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

// views: { front: Buffer, back?, left?, right? } (background-free PNGs work best)
export async function comfyMesh(views, { signal, log } = {}) {
  const model = config.COMFYUI_3D_MODEL || 'hunyuan3d-dit-v2-mv-turbo_fp16.safetensors';
  const info = await (await api('/object_info/ImageOnlyCheckpointLoader')).json();
  const have = info?.ImageOnlyCheckpointLoader?.input?.required?.ckpt_name?.[0] || [];
  if (!have.includes(model)) {
    throw new Error(`ComfyUI has no checkpoint "${model}" (found: ${have.join(', ') || 'none'}). Download it into ComfyUI/models/checkpoints: ` +
      (model.includes('2.1') ? 'https://huggingface.co/Comfy-Org/hunyuan3D_2.1_repackaged' : 'https://huggingface.co/Comfy-Org/hunyuan3D_2.0_repackaged/tree/main/split_files') + ' — then restart ComfyUI.');
  }
  const multi = /-mv/.test(model), turbo = /turbo/.test(model), v21 = /2\.1/.test(model);
  log?.('info', `ComfyUI is reconstructing the 3D shape with ${model}${multi ? ` from ${Object.keys(views).join(', ')} view(s)` : ''}…`);
  const prompt = {
    ckpt: { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: model } },
    sampling: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['ckpt', 0], shift: 1.0 } },
    latent: { class_type: 'EmptyLatentHunyuan3Dv2', inputs: { resolution: v21 ? 4096 : 3072, batch_size: 1 } },
    sampler: { class_type: 'KSampler', inputs: { model: ['sampling', 0], seed: 12345, steps: turbo ? 20 : 30, cfg: turbo ? 4 : 5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, latent_image: ['latent', 0] } },
    decode: { class_type: 'VAEDecodeHunyuan3D', inputs: { samples: ['sampler', 0], vae: ['ckpt', 2], num_chunks: 8000, octree_resolution: 256 } },
    mesh: { class_type: 'VoxelToMesh', inputs: { voxel: ['decode', 0], algorithm: 'surface net', threshold: 0.6 } },
    save: { class_type: 'SaveGLB', inputs: { mesh: ['mesh', 0], filename_prefix: 'blockforge/scan' } },
  };
  const order = multi ? ['front', 'left', 'back', 'right'].filter((v) => views[v]) : ['front'];
  for (const v of order) {
    prompt[`img_${v}`] = { class_type: 'LoadImage', inputs: { image: await upload(views[v], `blockforge_${v}_${Date.now()}.png`) } };
    prompt[`enc_${v}`] = { class_type: 'CLIPVisionEncode', inputs: { clip_vision: ['ckpt', 1], image: [`img_${v}`, 0], crop: multi ? 'none' : 'center' } };
  }
  if (multi) {
    prompt.cond = { class_type: 'Hunyuan3Dv2ConditioningMultiView', inputs: Object.fromEntries(order.map((v) => [v, [`enc_${v}`, 0]])) };
    prompt.guide = { class_type: 'FluxGuidance', inputs: { conditioning: ['cond', 0], guidance: 3.5 } };
    Object.assign(prompt.sampler.inputs, { positive: ['guide', 0], negative: ['cond', 1] });
  } else {
    prompt.cond = { class_type: 'Hunyuan3Dv2Conditioning', inputs: { clip_vision_output: ['enc_front', 0] } };
    Object.assign(prompt.sampler.inputs, { positive: ['cond', 0], negative: ['cond', 1] });
  }
  const { prompt_id: id } = await (await api('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: 'blockforge' }) })).json();
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) { await api('/interrupt', { method: 'POST' }).catch(() => {}); throw new Error('Stopped'); }
    await new Promise((r) => setTimeout(r, 2000));
    const h = (await (await api(`/history/${id}`)).json())[id];
    if (!h) { if (Date.now() - t0 > 15 * 60000) throw new Error('ComfyUI took longer than 15 minutes.'); continue; }
    if (h.status?.status_str === 'error') {
      const msg = (h.status.messages || []).find(([k]) => k === 'execution_error')?.[1];
      throw new Error(`ComfyUI failed: ${msg?.exception_message || 'see the ComfyUI console'}`);
    }
    const file = h.outputs?.save?.['3d']?.[0];
    if (!file) { if (h.status?.completed) throw new Error('ComfyUI finished without a GLB.'); continue; }
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
    const buf = Buffer.from(await (await api(`/view?${q}`)).arrayBuffer());
    log?.('info', `ComfyUI scan ready (${(buf.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s, untextured).`);
    return buf;
  }
}
