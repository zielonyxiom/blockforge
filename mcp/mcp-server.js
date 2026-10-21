#!/usr/bin/env node
// BlockForge MCP server (stdio). Lets Claude Code / Claude Desktop drive the
// running BlockForge app: edit the model, render views, read + generate references.
// The app must be running (npm start) and the editor open in a browser for renders.
import { loadConfig } from '../server/config.js';
import { MODEL_TOOLS, RENDER_TOOL, SCAN_TOOLS } from '../server/model.js';
import { BUILDER_SYSTEM, SCAN_GUIDE, PICTURE_RULES, treeRules, isTreeSubject } from '../server/prompts.js';
import { ROBLOX_RULES, PRESETS, presetOf } from '../server/roblox.js';
import { MESH_BACKENDS } from '../server/mesh3d.js';

const cfg = loadConfig();
const BASE = process.env.BLOCKFORGE_URL || `http://127.0.0.1:${cfg.PORT}`;

const EXTRA_TOOLS = [
  {
    name: 'get_build_guide',
    description: 'Read the modeling guide: coordinate system, conventions and workflow for rebuilding a model from references. Read this before building. Includes the tree-mode rules (tree_skeleton workflow) when the subject is a tree/bush/plant, or with tree: true.',
    input_schema: { type: 'object', properties: { tree: { type: 'boolean', description: 'include the tree-mode rules (default: automatic from the subject)' } } },
  },
  {
    name: 'list_references',
    description: 'List reference images of the current project (main views, part detail shots, user uploads) plus the subject and build plan.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'view_reference',
    description: 'Return one reference image (by file name or label from list_references), or all of them if `file` is "all".',
    input_schema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] },
  },
  {
    name: 'generate_references',
    description: 'Generate the main reference shots (3/4, front, back, left, right, top) for a subject with the configured GPT-Image model. Takes 1–3 minutes. Needs OPENAI_API_KEY in the app.',
    input_schema: { type: 'object', properties: { subject: { type: 'string', description: 'e.g. "Undead Skeleton Horse"' } }, required: ['subject'] },
  },
  {
    name: 'generate_part_reference',
    description: 'Generate a close-up detail reference image of one part (e.g. Head, Legs, Saddle) based on the main references.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name', 'description'] },
  },
  {
    name: 'generate_mesh',
    description: 'Turn the main reference image into a textured 3D scan on Hugging Face (~20 s–4 min), auto-aligned to the editor. Unlocks render_comparison, mesh_slices, tree_skeleton and blockify_mesh. backend overrides the Settings choice for this one scan: trellis (fast), trellis2 (detailed), hunyuan3d, hunyuan21 (Hunyuan3D-2.1, sharper; asks for 270 s of ZeroGPU quota), sam3d (Meta SAM 3D Objects; asks for 270 s).',
    input_schema: { type: 'object', properties: { backend: { type: 'string', enum: MESH_BACKENDS } } },
  },
  {
    name: 'set_mesh_transform',
    description: 'Fix the 3D scan alignment: yaw (0/90/180/270, so its front faces +Z) and/or height in studs.',
    input_schema: { type: 'object', properties: { yaw: { type: 'number' }, height: { type: 'number' } } },
  },
  {
    name: 'new_project',
    description: 'Create and open a new empty project (also sets the subject). preset = Roblox style: roblox_smooth (modern, default), roblox_studs (classic studs/LEGO), roblox_lowpoly (trending stylized), roblox_house (the game own look: 2022 MaterialVariants + gradient decals, free sizes and tilts), custom.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, preset: { type: 'string', enum: Object.keys(PRESETS) } }, required: ['name'] },
  },
  {
    name: 'set_style_preset',
    description: 'Switch the project\'s Roblox style preset (changes image style, build rules, and studs rendering/export).',
    input_schema: { type: 'object', properties: { preset: { type: 'string', enum: Object.keys(PRESETS) } }, required: ['preset'] },
  },
  {
    name: 'export_roblox',
    description: 'Export the model as a Roblox Studio .rbxmx file (anchored Parts/WedgeParts in Models, studs surfaces in classic style, facing Roblox front). Returns the file path.',
    input_schema: { type: 'object', properties: {} },
  },
];

const TOOLS = [...MODEL_TOOLS, RENDER_TOOL, ...SCAN_TOOLS, ...EXTRA_TOOLS];

async function http(path, body) {
  let res;
  try {
    res = await fetch(BASE + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`BlockForge app is not running at ${BASE}. Start it with "npm start" in the app folder.`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

async function callTool(name, args = {}) {
  switch (name) {
    case 'get_build_guide': {
      const st = await http('/api/state');
      const preset = presetOf(st.project?.preset);
      const tree = args.tree ?? isTreeSubject(`${st.project?.subject || ''} ${st.project?.name || ''}`);
      return text(`${BUILDER_SYSTEM}\n\n${ROBLOX_RULES}\n\n${preset.rules}\n\n${PICTURE_RULES}\n\n${SCAN_GUIDE}\n(The scan tools only work after generate_mesh or when the project already has a scan.)${tree ? '\n\n' + treeRules(st.project?.preset) : ''}\nWhen done: export_roblox.`);
    }
    case 'set_style_preset': {
      await http('/api/projects/preset', { preset: args.preset });
      return text(`Style preset is now ${PRESETS[args.preset].label}. Read get_build_guide for its rules.`);
    }
    case 'generate_mesh': {
      const r = await http('/api/gen/mesh', { backend: args.backend });
      return text(`3D scan ready (${r.mesh?.source}, yaw ${r.mesh?.yaw}°, height ${r.mesh?.height} studs). Check it with render_comparison or mesh_slices.`);
    }
    case 'set_mesh_transform': {
      const r = await http('/api/mesh/transform', args);
      return text(`Scan transform: yaw ${r.yaw}°, height ${r.height} studs.`);
    }
    case 'list_references': {
      const st = await http('/api/state');
      const lines = st.refs.map((r) => `- ${r.file} — ${r.label}${r.description ? `: ${r.description}` : ''}`);
      return text(`Project: ${st.project?.name}\nSubject: ${st.project?.subject || '(none)'}\n` +
        (st.project?.plan ? `Plan: ${JSON.stringify(st.project.plan)}\n` : '') +
        `References (${st.refs.length}):\n${lines.join('\n') || '(none)'}`);
    }
    case 'view_reference': {
      const st = await http('/api/state');
      const files = args.file === 'all' ? st.refs.map((r) => r.file) : [args.file];
      const content = [];
      for (const f of files) {
        const r = await http('/api/refs/read', { file: f });
        content.push({ type: 'text', text: `${r.label}${r.description ? `: ${r.description}` : ''}` });
        content.push({ type: 'image', data: r.image, mimeType: r.file.endsWith('.jpg') ? 'image/jpeg' : r.file.endsWith('.webp') ? 'image/webp' : 'image/png' });
      }
      return { content };
    }
    case 'generate_references': {
      const r = await http('/api/gen/references', { subject: args.subject });
      return text(`Generated. References now: ${r.refs.map((x) => x.file).join(', ')}. Use view_reference to look at them.`);
    }
    case 'generate_part_reference': {
      const r = await http('/api/gen/part', args);
      return text(`Generated. References now: ${r.refs.map((x) => x.file).join(', ')}.`);
    }
    case 'new_project': {
      await http('/api/projects/new', { name: args.name, subject: args.name, preset: args.preset });
      return text(`Opened new project "${args.name}" (${presetOf(args.preset).label}).`);
    }
    default: {
      const r = await http('/api/tool', { name, input: args });
      if (r.image) return { content: [{ type: 'image', data: r.image, mimeType: r.mime }, { type: 'text', text: r.text }] };
      return text(r.text);
    }
  }
}

// ---- JSON-RPC over stdio (newline-delimited) -----------------------------
function reply(id, result, error) {
  const msg = error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'blockforge', version: '0.1.0' },
          instructions: 'BlockForge is a blocky (Roblox-style) 3D modeler. Typical flow: new_project → generate_references (or use existing) → view_reference "all" → generate_mesh (3D scan via Hugging Face) → get_build_guide → mesh_slices (trees: tree_skeleton) → add_parts / mirror_part → render_comparison + render_views → fix → repeat → roblox_snap (classic studs) → export_roblox. Everything follows Roblox rules (studs, BrickColors, Roblox materials).',
        });
      case 'ping': return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
      case 'tools/call':
        try {
          return reply(id, await callTool(params.name, params.arguments || {}));
        } catch (e) {
          return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
        }
      default:
        return reply(id, null, { code: -32601, message: `Method not found: ${method}` });
    }
  } catch (e) {
    reply(id, null, { code: -32603, message: e.message });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
