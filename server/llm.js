// The "brain" (planning, orientation, building) behind one interface.
// Internally everything speaks the Anthropic Messages format (content blocks:
// text / image / tool_use / tool_result). For other providers the request is
// translated to OpenAI Chat Completions, which Google Gemini, OpenAI,
// OpenRouter and Ollama all accept, and the reply is translated back.
import { config, notify } from './config.js';
import { claudeMessage } from './claude.js';

// Free tiers have small per-model daily quotas (Gemini: 20 requests/day/model),
// so when one model runs out we rotate to the next one automatically.
const DEFAULT_FALLBACKS = {
  gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'],
  openrouter: ['openrouter/free'],
};
const exhausted = new Map(); // model → timestamp when it can be tried again

function modelChain(info) {
  const extra = (config.LLM_FALLBACK_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = [info.model, ...(extra.length ? extra : DEFAULT_FALLBACKS[info.id] || [])];
  return [...new Set(list)];
}
function pickModel(info) {
  const now = Date.now();
  return modelChain(info).find((m) => !(exhausted.get(m) > now)) || null;
}
// "Please retry in 20h46m34s" / "retry in 23.5s" / retryDelay "74794s" → seconds
function retrySeconds(text) {
  const m = /retry in ((?:\d+h)?(?:\d+m)?[\d.]+s)/i.exec(text);
  if (m) {
    const t = m[1];
    return (Number(/(\d+)h/.exec(t)?.[1] || 0) * 3600) + (Number(/(\d+)m(?!s)/.exec(t)?.[1] || 0) * 60) + Number(/([\d.]+)s$/.exec(t)?.[1] || 0);
  }
  const d = /"retryDelay":\s*"(\d+)s"/.exec(text);
  return d ? Number(d[1]) : null;
}
export const isFreeProvider = () => llmInfo().id !== 'anthropic' && llmInfo().id !== 'openai';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic Claude', base: 'https://api.anthropic.com', model: () => config.CLAUDE_MODEL, key: () => config.ANTHROPIC_API_KEY },
  gemini: { label: 'Google Gemini (free tier)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: () => 'gemini-3.8-flash', key: () => config.GEMINI_API_KEY },
  openai: { label: 'OpenAI', base: null, model: () => 'gpt-5.5', key: () => config.OPENAI_API_KEY },
  openrouter: { label: 'OpenRouter (free models)', base: 'https://openrouter.ai/api/v1', model: () => 'openrouter/free', key: () => config.OPENROUTER_API_KEY },
  ollama: { label: 'Ollama (local, free)', base: 'http://localhost:11434/v1', model: () => 'qwen2.5vl', key: () => 'ollama' },
};

export function llmInfo() {
  const id = PROVIDERS[config.LLM_PROVIDER] ? config.LLM_PROVIDER : 'anthropic';
  const p = PROVIDERS[id];
  const base = (config.LLM_BASE_URL || p.base || config.OPENAI_BASE_URL).replace(/\/$/, '');
  const model = id === 'anthropic' ? config.CLAUDE_MODEL : (config.LLM_MODEL || p.model());
  return { id, label: p.label, base, model, key: p.key(), ready: !!p.key() };
}
export const llmReady = () => llmInfo().ready;
export const llmName = () => { const i = llmInfo(); return `${i.label} · ${(i.id !== 'anthropic' && pickModel(i)) || i.model}`; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let callSeq = 0;

// ---- Anthropic blocks → OpenAI messages -------------------------------------
const imgPart = (b) => ({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });

function toOpenAIMessages(system, messages) {
  const out = [];
  const sys = Array.isArray(system) ? system.map((b) => b.text).join('\n\n') : system;
  if (sys) out.push({ role: 'system', content: sys });
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({
        ...(b._raw || {}), // keeps provider extras such as Gemini thought signatures
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
      }));
      const msg = { role: 'assistant', content: text || (calls.length ? null : '') };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    // user turn: tool results become "tool" messages; images can't go in a tool
    // message, so they follow in a user message right after.
    const parts = [], toolMsgs = [], toolImages = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') parts.push(imgPart(b));
      else if (b.type === 'tool_result') {
        let text = '';
        if (typeof b.content === 'string') text = b.content;
        else for (const c of b.content || []) {
          if (c.type === 'text') text += c.text + '\n';
          else if (c.type === 'image') toolImages.push({ type: 'text', text: 'Image returned by the previous tool call:' }, imgPart(c));
        }
        toolMsgs.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'ERROR: ' : '') + (text.trim() || 'ok') });
      }
    }
    out.push(...toolMsgs);
    const userParts = [...toolImages, ...parts];
    if (userParts.length) out.push({ role: 'user', content: userParts });
  }
  return out;
}

// Strip JSON-schema keywords some providers reject.
function cleanSchema(s) {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (['minItems', 'maxItems', 'cache_control'].includes(k)) continue;
    o[k] = cleanSchema(v);
  }
  return o;
}

// Pull a JSON object out of free text (fallback when a model ignores forced tool use).
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function openaiCompatible({ system, messages, tools, tool_choice, max_tokens, signal }) {
  const info = llmInfo();
  if (!info.ready) throw new Error(`No API key for ${info.label} — open Settings and add it.`);
  const body = {
    model: info.model,
    messages: toOpenAIMessages(system, messages),
  };
  const maxTok = Math.min(max_tokens || 8192, Number(config.LLM_MAX_TOKENS) || 8192);
  if (info.id === 'openai') body.max_completion_tokens = maxTok; else body.max_tokens = maxTok;
  if (tools?.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: cleanSchema(t.input_schema) } }));
    if (tool_choice?.type === 'tool') body.tool_choice = { type: 'function', function: { name: tool_choice.name } };
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${info.key}` };
  if (info.id === 'openrouter') { headers['HTTP-Referer'] = 'http://localhost'; headers['X-Title'] = 'BlockForge'; }

  let json;
  const overloads = new Map(); // model → consecutive 5xx count
  for (let attempt = 0; attempt < 40; attempt++) {
    let model = pickModel(info);
    if (!model) {
      // Everything is exhausted or temporarily overloaded: wait for the soonest one (if it's soon).
      const soonest = Math.min(...modelChain(info).map((m) => exhausted.get(m) || 0));
      const wait = soonest - Date.now();
      if (wait > 0 && wait <= 5 * 60e3) {
        notify('info', `All Gemini models are busy — waiting ${Math.ceil(wait / 1000)} s…`);
        await sleep(wait + 500);
        model = pickModel(info);
      }
      if (!model) throw new Error(`${info.label}: every model in the fallback list (${modelChain(info).join(', ')}) has used its free quota for today. It resets in ~24 h — or build from an MCP client.`);
    }
    body.model = model;
    const res = await fetch(`${info.base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    const text = await res.text();
    if (res.ok) { json = JSON.parse(text); break; }
    // Some providers/models refuse a forced tool_choice: retry once with "auto".
    if (res.status === 400 && body.tool_choice && /tool_choice|tool choice/i.test(text)) { delete body.tool_choice; continue; }
    if (res.status === 429 && attempt < 12) {
      const secs = retrySeconds(text) ?? (Number(res.headers.get('retry-after')) || null);
      const daily = /PerDay|per day/i.test(text) || (secs && secs > 120);
      if (daily) {
        exhausted.set(model, Date.now() + (secs || 86400) * 1000);
        const next = pickModel(info);
        notify('info', `${model}: free daily quota used up${next ? ` → switching to ${next}` : ''}.`);
        continue;
      }
      const wait = Math.min(90, (secs || 10 * (attempt + 1))) + 1;
      notify('info', `${model}: per-minute limit hit, waiting ${Math.round(wait)} s…`);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 404 && /no longer available|not found/i.test(text) && attempt < 12) {
      exhausted.set(model, Date.now() + 30 * 86400e3);
      notify('info', `${model} isn't available for this key → trying ${pickModel(info) || 'nothing else'}.`);
      continue;
    }
    if (res.status >= 500) {
      // "high demand" / overloaded: retry a couple of times, then rest this model and rotate.
      const n = (overloads.get(model) || 0) + 1;
      overloads.set(model, n);
      if (n <= 2) { await sleep(5000 * n); continue; }
      exhausted.set(model, Date.now() + 3 * 60e3);
      overloads.set(model, 0);
      notify('info', `${model} is overloaded (${res.status}) → trying ${pickModel(info) || 'again shortly'}.`);
      continue;
    }
    let msg = text;
    try { const e = JSON.parse(text); msg = e.error?.message || e[0]?.error?.message || text; } catch {}
    throw new Error(`${info.label} ${res.status}: ${String(msg).slice(0, 400)}`);
  }
  if (!json) throw new Error(`${info.label}: gave up after too many retries.`);

  const msg = json.choices?.[0]?.message || {};
  const content = [];
  const textOut = Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : (msg.content || '');
  if (textOut.trim()) content.push({ type: 'text', text: textOut });
  for (const tc of msg.tool_calls || []) {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = extractJson(tc.function?.arguments || '') || {}; }
    const { function: _f, type: _t, id: _i, index: _x, ...extra } = tc;
    content.push({ type: 'tool_use', id: tc.id || `call_${++callSeq}`, name: tc.function?.name, input, _raw: extra });
  }
  // Forced tool but the model answered in text: recover the JSON from the text.
  if (tool_choice?.type === 'tool' && !content.some((b) => b.type === 'tool_use')) {
    const data = extractJson(textOut);
    if (data) content.push({ type: 'tool_use', id: `call_${++callSeq}`, name: tool_choice.name, input: data });
  }
  const fr = json.choices?.[0]?.finish_reason;
  const stop_reason = fr === 'length' ? 'max_tokens' : content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  return { content, stop_reason };
}

export async function chat(args) {
  return llmInfo().id === 'anthropic' ? claudeMessage(args) : openaiCompatible(args);
}

export async function listModels() {
  const info = llmInfo();
  if (info.id === 'anthropic') return [config.CLAUDE_MODEL, 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
  if (!info.ready) throw new Error(`Add the ${info.label} key first.`);
  const res = await fetch(`${info.base}/models`, { headers: { Authorization: `Bearer ${info.key}` } });
  if (!res.ok) throw new Error(`${info.label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.data || j.models || []).map((m) => (m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}
