// Image generation: OpenAI GPT-Image, Gemini, Cloudflare, Pollinations, Hugging Face.
import { config, notify } from './config.js';

export function mimeOf(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return 'image/png';
}

async function readImageResponse(res) {
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Image API ${res.status}: ${text.slice(0, 300)}`); }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 300);
    const hint = /model/i.test(msg) ? ` (check IMAGE_MODEL="${config.IMAGE_MODEL}" in Settings)` : '';
    throw new Error(`Image API ${res.status}: ${msg}${hint}`);
  }
  const d = json.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
  throw new Error('Image API returned no image');
}

function requireKey() {
  if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set — open Settings and add it.');
}

// ---- Hugging Face Inference Providers (FLUX text-to-image, FLUX Kontext edits) ----
async function hfClient() {
  if (!config.HF_TOKEN) throw new Error('HF_TOKEN is not set — open Settings and add a Hugging Face token (needed for Inference Providers).');
  const { InferenceClient } = await import('@huggingface/inference');
  return new InferenceClient(config.HF_TOKEN);
}

async function hfGenerate(prompt, size, signal) {
  const [width, height] = /^\d+x\d+$/.test(size) ? size.split('x').map(Number) : [1024, 1024];
  const blob = await (await hfClient()).textToImage(
    { provider: config.HF_PROVIDER, model: config.HF_IMAGE_MODEL, inputs: prompt, parameters: { width, height } },
    { outputType: 'blob', signal },
  );
  return Buffer.from(await blob.arrayBuffer());
}

// Kontext-style models take one input image; the first reference is the main one.
async function hfEdit(prompt, images, signal) {
  const blob = await (await hfClient()).imageToImage(
    { provider: config.HF_PROVIDER, model: config.HF_EDIT_MODEL, inputs: new Blob([images[0]], { type: mimeOf(images[0]) }), parameters: { prompt } },
    { signal },
  );
  return Buffer.from(await blob.arrayBuffer());
}

// ---- Google Gemini image ("Nano Banana"): free-tier key, supports edits ----
async function geminiImage(prompt, images = [], signal) {
  if (!config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set — get a free key at aistudio.google.com and add it in Settings.');
  const parts = [{ text: prompt }, ...images.slice(0, 3).map((b) => ({ inline_data: { mime_type: mimeOf(b), data: b.toString('base64') } }))];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_IMAGE_MODEL}:generateContent`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
    });
    const text = await res.text();
    if (res.status === 429 && attempt < 4 && !/limit: 0|quota.*0/i.test(text)) { await new Promise((r) => setTimeout(r, 8000 * (attempt + 1))); continue; }
    if (!res.ok) {
      let msg = text; try { msg = JSON.parse(text).error?.message || text; } catch {}
      throw new Error(`Gemini image ${res.status}: ${String(msg).slice(0, 300)}${res.status === 429 ? ' (free quota used up — try IMAGE_PROVIDER pollinations or cloudflare)' : ''}`);
    }
    const j = JSON.parse(text);
    const img = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
    if (!img) throw new Error('Gemini returned no image (it may have refused the prompt).');
    return Buffer.from((img.inlineData || img.inline_data).data, 'base64');
  }
}

// ---- Cloudflare Workers AI: FLUX.1 schnell, free daily allowance (text-to-image only) ----
async function cloudflareImage(prompt, signal) {
  if (!config.CF_ACCOUNT_ID || !config.CF_API_TOKEN) throw new Error('Cloudflare needs CF_ACCOUNT_ID and CF_API_TOKEN (free account at dash.cloudflare.com → Workers AI).');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.CF_ACCOUNT_ID}/ai/run/${config.CF_IMAGE_MODEL}`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${config.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 8 }),
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 300)}`);
  if (ct.startsWith('image/')) return Buffer.from(await res.arrayBuffer());
  const j = await res.json();
  const b64 = j.result?.image;
  if (!b64) throw new Error('Cloudflare returned no image');
  return Buffer.from(b64, 'base64');
}

// ---- Pollinations: free, works with no key (slow, watermark; free token removes it) ----
// The prompt travels in the URL path: no slashes/newlines/odd symbols, and keep it short.
function pollinationsPrompt(prompt, max) {
  return prompt
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/[#%?&\\<>{}|^`"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function pollinationsImage(prompt, size, signal) {
  const [w, h] = /^\d+x\d+$/.test(size) ? size.split('x') : [1024, 1024];
  const q = new URLSearchParams({ width: w, height: h, model: config.POLLINATIONS_MODEL || 'flux', nologo: 'true', seed: String(Math.floor(Math.random() * 1e6)) });
  const headers = config.POLLINATIONS_TOKEN ? { Authorization: `Bearer ${config.POLLINATIONS_TOKEN}` } : {};
  let max = 1000, waits = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(pollinationsPrompt(prompt, max))}?${q}`;
    let res;
    try { res = await fetch(url, { headers, signal }); }
    catch (e) {
      if (signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, 10000)); // flaky free service: connection timeouts happen
      continue;
    }
    if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    // Free tier: 1 image / 45 s per IP → wait the time it asks for, then retry.
    if ((res.status === 402 || res.status === 429) && waits++ < 2) {
      const secs = Number(/after (\d+)\s*s/i.exec(text)?.[1]) || 45;
      await new Promise((r) => setTimeout(r, (secs + 2) * 1000));
      continue;
    }
    if (res.status === 404 || res.status === 414 || res.status === 400) { max = Math.max(250, Math.floor(max / 2)); continue; } // too long / rejected path
    if (res.status >= 500) { await new Promise((r) => setTimeout(r, 15000)); continue; }
    throw new Error(`Pollinations ${res.status}: ${text.slice(0, 200)}`);
  }
  throw new Error('Pollinations kept refusing the request (free limit is 1 image every 45 s per IP). Try again in a minute, add a free Pollinations key in Settings, or use your own image with "Build from my image".');
}

// ---- Hugging Face Space: FLUX.1 schnell on free ZeroGPU (HF token = more quota) ----
async function hfSpaceImage(prompt, size, signal) {
  const { Client } = await import('@gradio/client');
  const [width, height] = /^\d+x\d+$/.test(size) ? size.split('x').map(Number) : [1024, 1024];
  const opts = config.HF_TOKEN?.startsWith('hf_') ? { token: config.HF_TOKEN } : {};
  const c = await Client.connect('black-forest-labs/FLUX.1-schnell', opts);
  const aborted = new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('Stopped')), { once: true }));
  const r = await Promise.race([c.predict('/infer', { prompt: prompt.slice(0, 1500), seed: 0, randomize_seed: true, width, height, num_inference_steps: 4 }), aborted]);
  const file = r.data?.[0];
  const url = file?.url || file?.value?.url;
  if (!url) throw new Error('FLUX Space returned no image');
  const res = await fetch(url, { headers: config.HF_TOKEN ? { Authorization: `Bearer ${config.HF_TOKEN}` } : {} });
  if (!res.ok) throw new Error(`FLUX Space download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const PROVIDER_LABEL = {
  openai: () => `${config.IMAGE_MODEL} (OpenAI)`,
  huggingface: () => `${config.HF_IMAGE_MODEL} (Hugging Face)`,
  gemini: () => `${config.GEMINI_IMAGE_MODEL} (Gemini)`,
  cloudflare: () => `${config.CF_IMAGE_MODEL} (Cloudflare, free tier)`,
  pollinations: () => `${config.POLLINATIONS_MODEL} (Pollinations, free)`,
  hf_space: () => 'FLUX.1 schnell (Hugging Face Space, free)',
};
export const imageModelName = () => (PROVIDER_LABEL[config.IMAGE_PROVIDER] || PROVIDER_LABEL.openai)();
// Can the provider edit/re-render an existing image? (needed for consistent extra views + part shots)
export const canEditImages = () => ['openai', 'huggingface', 'gemini'].includes(config.IMAGE_PROVIDER);

// Free fallbacks tried in order when the chosen provider fails (quota, outage, 404…).
const FREE_FALLBACKS = ['pollinations', 'hf_space'];

export async function generateImage(args) {
  const chain = [config.IMAGE_PROVIDER, ...FREE_FALLBACKS.filter((p) => p !== config.IMAGE_PROVIDER)];
  const errors = [];
  for (const provider of chain) {
    try {
      if (errors.length) notify('info', `Trying ${PROVIDER_LABEL[provider]()} instead…`);
      return await generateWith(provider, args);
    } catch (e) {
      if (args.signal?.aborted) throw e;
      errors.push(`${PROVIDER_LABEL[provider]?.() || provider}: ${e.message}`);
      notify('error', `Image generation failed — ${errors.at(-1).slice(0, 220)}`);
    }
  }
  throw new Error(`All image providers failed. Tip: use your own picture with "Build from my image".\n${errors.join('\n')}`);
}

async function generateWith(provider, { prompt, size = config.IMAGE_SIZE, quality = config.IMAGE_QUALITY, signal }) {
  switch (provider) {
    case 'huggingface': return hfGenerate(prompt, size, signal);
    case 'gemini': return geminiImage(prompt, [], signal);
    case 'cloudflare': return cloudflareImage(prompt, signal);
    case 'pollinations': return pollinationsImage(prompt, size, signal);
    case 'hf_space': return hfSpaceImage(prompt, size, signal);
  }
  requireKey();
  const res = await fetch(`${config.OPENAI_BASE_URL}/images/generations`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.IMAGE_MODEL, prompt, size, quality, n: 1 }),
  });
  return readImageResponse(res);
}

// Image-to-image: `images` are reference Buffers (first one is the main reference).
export async function editImage({ prompt, images, size = config.IMAGE_SIZE, quality = config.IMAGE_QUALITY, signal }) {
  if (config.IMAGE_PROVIDER === 'huggingface') return hfEdit(prompt, images, signal);
  if (config.IMAGE_PROVIDER === 'gemini') return geminiImage(prompt, images, signal);
  if (!canEditImages()) throw new Error(`${imageModelName()} can't edit images`);
  requireKey();
  const form = new FormData();
  form.append('model', config.IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  form.append('n', '1');
  images.slice(0, 16).forEach((buf, i) => {
    const type = mimeOf(buf);
    form.append('image[]', new Blob([buf], { type }), `ref${i}.${type.split('/')[1]}`);
  });
  const res = await fetch(`${config.OPENAI_BASE_URL}/images/edits`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: form,
  });
  return readImageResponse(res);
}
