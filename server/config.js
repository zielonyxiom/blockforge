import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT, '.env');
export const PROJECTS_DIR = path.join(ROOT, 'projects');
export const STYLE_DIR = path.join(ROOT, 'style');

export const DEFAULTS = {
  PORT: '5177',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
  IMAGE_MODEL: 'gpt-image-2.5-sunburst',
  IMAGE_QUALITY: 'high',
  IMAGE_SIZE: '1024x1024',
  // Hugging Face: image provider alternative + image-to-3D Spaces
  HF_TOKEN: '',
  IMAGE_PROVIDER: 'openai', // openai | gemini | cloudflare | pollinations | huggingface
  GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',
  CF_ACCOUNT_ID: '',
  CF_API_TOKEN: '',
  CF_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
  POLLINATIONS_TOKEN: '',
  POLLINATIONS_MODEL: 'flux',
  HF_IMAGE_MODEL: 'black-forest-labs/FLUX.1-dev',
  HF_EDIT_MODEL: 'black-forest-labs/FLUX.1-Kontext-dev',
  HF_PROVIDER: 'auto',
  MESH_BACKEND: 'trellis', // trellis | trellis2 | hunyuan3d
  TRELLIS_SPACE: 'trellis-community/TRELLIS',
  TRELLIS2_SPACE: 'microsoft/TRELLIS.2',
  HUNYUAN_SPACE: 'tencent/Hunyuan3D-2',
  // "Brain" for planning/building: anthropic | gemini | openai | openrouter | ollama
  LLM_PROVIDER: 'anthropic',
  LLM_MODEL: '',      // blank = provider default
  LLM_BASE_URL: '',   // blank = provider default
  LLM_MAX_TOKENS: '8192',
  LLM_MAX_TURNS: '18',       // per build, for free providers (each turn = 1 request)
  LLM_FALLBACK_MODELS: '',   // comma list; blank = sensible defaults per provider
  GEMINI_API_KEY: '',
  OPENROUTER_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  CLAUDE_MODEL: 'claude-opus-5-5',
  CLAUDE_MAX_TURNS: '60',
};

export const EDITABLE = Object.keys(DEFAULTS).filter((k) => k !== 'PORT');
export const SECRET = new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'HF_TOKEN', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'CF_API_TOKEN', 'POLLINATIONS_TOKEN']);

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

export const config = { ...DEFAULTS };

// Lets low-level modules (llm.js, images.js) post messages to the app log.
export let notify = () => {};
export function setNotifier(fn) { notify = fn; }

export function loadConfig() {
  const file = fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, 'utf8')) : {};
  for (const k of Object.keys(DEFAULTS)) config[k] = process.env[k] || file[k] || DEFAULTS[k];
  return config;
}

// Write values into .env, keeping unrelated lines and comments.
export function saveConfig(updates) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(updates)) {
    if (!EDITABLE.includes(k)) continue;
    const val = String(v ?? '').trim();
    const idx = lines.findIndex((l) => l.trim().startsWith(k + '='));
    if (idx >= 0) lines[idx] = `${k}=${val}`;
    else lines.push(`${k}=${val}`);
    config[k] = val || DEFAULTS[k];
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n').replace(/\n*$/, '\n'));
}

export function publicConfig() {
  const out = {};
  for (const k of EDITABLE) {
    const v = config[k];
    out[k] = SECRET.has(k) ? (v ? `set (…${v.slice(-4)})` : '') : v;
  }
  return out;
}
