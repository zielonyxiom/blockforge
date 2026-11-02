<div align="center">

# BlockForge

**Block-built, stud-style 3D models: from a picture or a blank scene to Roblox Studio.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f81f7?style=flat-square)](LICENSE)
![Node.js 20+](https://img.shields.io/badge/node-20%2B-3c873a?style=flat-square)
![Export](https://img.shields.io/badge/export-.rbxmx%20%C2%B7%20GLB%20%C2%B7%20OBJ-e2231a?style=flat-square)
![MCP](https://img.shields.io/badge/MCP-server-d97757?style=flat-square)

[Features](#features) · [Installation](#installation) · [Workflow](#workflow) · [Configuration](#configuration) · [MCP](#mcp)

<img src="docs/showcase.jpg" alt="Five stud-style trees built with BlockForge (an oak, a pyramid, a pagoda, a lighthouse and a kraken), rendered in Roblox Studio" width="100%">

</div>

BlockForge is a local 3D modeling tool for block-built, stud-style models. Start from a picture or a blank scene, build the model from parts in the browser editor, check it against the reference, and export it to Roblox Studio or any 3D tool.

## Gallery

<p align="center">
  <img src="docs/gallery.jpg" alt="Twelve stud-style trees built with BlockForge, each shown from the front three-quarter view in Roblox Studio" width="100%">
</p>

<p align="center"><sub>Stud-style trees built with BlockForge, shown in Roblox Studio.</sub></p>

## Features

| | |
| --- | --- |
| **Editor** | Block modeling in the browser: parts, groups, mirroring, snapping, materials and colours |
| **References** | Pictures from your own files or generated in the app, with background removal |
| **3D scan** | Image-to-3D reconstruction (TRELLIS, Hunyuan3D, SAM 3D, or ComfyUI on your own GPU) used as a size and depth guide |
| **AI build** | An optional AI model plans and builds the parts from the references |
| **Checks** | Side-by-side renders, silhouette match against the picture, automatic polish |
| **MCP** | An MCP server that lets an AI client drive the editor with the same tools |
| **Export** | Roblox `.rbxmx` and a Studio script, plus GLB and OBJ |

## Installation

Requirements: [Node.js](https://nodejs.org) 20 or later and a modern browser.

```sh
git clone https://github.com/zielonyxiom/blockforge.git
cd blockforge
npm install
npm start
```

Open <http://localhost:5177>. Keys and options are set in the app under **Settings**, or in a `.env` file based on `.env.example`. None are required to model by hand.

## Workflow

1. **Reference.** Create a project and add a picture of what you want to model.
2. **Scan.** Optionally reconstruct the picture in 3D to get true proportions and depth.
3. **Build.** Place parts by hand, let the AI build a first pass, or drive the editor from an MCP client.
4. **Check.** Compare renders with the picture and the scan from every side, then polish.
5. **Export.** Download `.rbxmx`, GLB or OBJ, or paste the generated script into Roblox Studio.

## Configuration

| Setting | Purpose |
| --- | --- |
| `HF_TOKEN` | Hugging Face token for 3D scans and background removal (free, recommended) |
| `MESH_BACKEND` | Scan model: `trellis`, `trellis2`, `hunyuan3d`, `hunyuan21`, `sam3d` or `comfyui` |
| `LLM_PROVIDER` | AI build provider: `gemini`, `openrouter`, `ollama`, `openai` or `anthropic` |
| `PORT` | Editor port, default `5177` |

The full list with defaults is in `.env.example`. The `.env` file stays on your machine and is ignored by git.

## MCP

```sh
npm run mcp:install
```

This registers the server with Claude Code when it is installed, and otherwise prints the entry to add to any MCP client. Keep BlockForge running with the editor open while the client works.

## Project structure

| Folder | Contents |
| --- | --- |
| `server/` | Local server: project storage, build pipeline, scan backends, exporters |
| `public/` | Browser editor |
| `mcp/` | MCP server |
| `scripts/` | Setup scripts |
| `style/` | Your own style example pictures (optional, not committed) |
| `docs/` | Images used by this README |

## Third-party models

Scans and background removal run on third-party models. BRIA RMBG-2.0 and Hunyuan3D-2.1 are licensed for non-commercial use only. Check each model's license before commercial work.

## License

Released under the [MIT License](LICENSE). Maintained by zielonyxiom.
