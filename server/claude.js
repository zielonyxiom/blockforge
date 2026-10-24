// Minimal Anthropic Messages API client (no SDK dependency).
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function claudeMessage({ system, messages, tools, tool_choice, max_tokens = 16000, signal }) {
  if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set — open Settings and add it (or drive the editor from an MCP client instead).');
  const body = { model: config.CLAUDE_MODEL, max_tokens, system, messages };
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (retryable && attempt < 5) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      await sleep(Math.min(wait, 60000));
      continue;
    }
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch {}
    throw new Error(`Claude API ${res.status}: ${msg.slice(0, 400)}`);
  }
}

export const imageBlock = (buf, mime = 'image/png') => ({
  type: 'image',
  source: { type: 'base64', media_type: mime, data: buf.toString('base64') },
});
