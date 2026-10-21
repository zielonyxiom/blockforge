<div align="center">

# ▣ BlockForge

### Turn a picture into an almost 1:1, stud-style Roblox model.

Drop in a picture → BlockForge scans it into 3D, rebuilds it out of real Roblox parts, checks itself against your picture from the same camera angle, polishes it automatically, and exports a file you can drag into Roblox Studio.

![license](https://img.shields.io/badge/license-MIT-blue) ![windows](https://img.shields.io/badge/Windows-%E2%9C%93-0078d6) ![mac](https://img.shields.io/badge/macOS-%E2%9C%93-lightgrey) ![linux](https://img.shields.io/badge/Linux-%E2%9C%93-yellow) ![free](https://img.shields.io/badge/runs%20on-free%20APIs-brightgreen) ![export](https://img.shields.io/badge/export-Roblox%20Studio%20.rbxmx-red)

![BlockForge demo model](docs/demo-views.jpg)

</div>

---

## ⬇️ Download & install

You only need **Node.js** (free). The installers set everything else up for you.

### 🪟 Windows — one line
Open **PowerShell** (Start menu → type *PowerShell*) and paste:
```powershell
irm https://raw.githubusercontent.com/zielonyxiom/blockforge/main/install.ps1 | iex
```
It installs Node.js if you don't have it, downloads BlockForge to `C:\Users\<you>\BlockForge`, adds a **BlockForge** shortcut to your Desktop and Start menu, and opens the app.

### 🍎 macOS / 🐧 Linux — one line
```bash
curl -fsSL https://raw.githubusercontent.com/zielonyxiom/blockforge/main/install.sh | sh
```

### 📦 Or download the ZIP
1. Get **[BlockForge.zip from the latest release](https://github.com/zielonyxiom/blockforge/releases/latest)** and unzip it anywhere.
2. Double-click **`start.bat`** (Windows) or run **`./start.sh`** (macOS/Linux).
   *No Node.js yet? `start.bat` offers to install it for you.*

The app opens at **http://localhost:5177**. Keep its window open while you use it.
**Updating:** run the one-line installer again — your keys and projects are kept.

---

## 🔑 Free keys (2 minutes)

Click **Settings** in the app and paste:

| Key | Cost | Get it | What it's for |
|---|---|---|---|
| **Hugging Face token** | free | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) → *New token → Read* | 3D scans + background removal (much more free GPU time than without) |
| **Google Gemini key** | free tier | [aistudio.google.com](https://aistudio.google.com) → *Get API key* | The AI builder inside the app |
| *optional* OpenRouter / Ollama | free | [openrouter.ai/keys](https://openrouter.ai/keys) · [ollama.com](https://ollama.com) | Other free builders (Ollama runs offline on your GPU) |
| *optional* OpenAI / Anthropic | paid | — | GPT-Image pictures, Claude as the builder |

> 🔒 **Your keys never leave your PC.** They're stored in `.env` next to the app (git-ignored, never uploaded). Your projects stay in the local `projects/` folder.

---

## ✨ What it does

- 🖼️ **Picture → Roblox model** — a render, an AI image or a screenshot. Click **🖼 Build from my image**.
- 🧊 **Free 3D scan** — removes the background (BRIA RMBG-2.0) and reconstructs the object in 3D (TRELLIS / TRELLIS.2 / Hunyuan3D-2 / Hunyuan3D-2.1 / SAM 3D Objects on Hugging Face, pick one in Settings) for exact depth and proportions.
- 🎯 **Checks itself against your picture** — finds the camera angle and lens the picture was taken with, renders the model from exactly that view and overlays it on your picture (red = missing, blue = extra, plus a match score).
- ✨ **Auto-polish** — nudges every part's position, size and tilt until the model matches your picture *and* the 3D scan from 5 sides, while keeping the build clean and blocky.
- 🎨 **Colors from your picture** — reads each material's real color off the picture (lit faces, not shadows).
- 🌳 **Tree mode** — trees are split into a trunk skeleton, straight branch segments and a few box-shaped canopy clusters (`tree_skeleton`), then built as stacked trunk boxes, rotated branch boxes and layered canopy slabs — no staircases.
- 🧱 **Stud counting** — in stud-style pictures every stud is 1 stud, so a face with 9×3 studs is a 9×3 part. The builder counts.
- 🟥 **Roblox rules built in** — stud scale, one primitive = one Part, BrickColors, 21 Roblox materials, rig-ready groups. Styles: **Smooth (modern)**, **Studs (classic)**, **Stylized low-poly (trending)**, **House (2022 variants)**; surfaces: **Smooth / Studs on top / Studs everywhere / House**.
- 📦 **Exports to Roblox Studio** (`.rbxmx`: anchored Parts & WedgeParts in named Models, studs surfaces) plus GLB / OBJ / JSON; imports BlockBench `.bbmodel`.
- 🗂️ **Batch import** — turn a whole folder of pictures into projects; scans run as your free quota allows and resume later.
- 🤖 **Claude Code integration (MCP)** — Claude drives the editor with 28 tools for the best builds, no API key needed.

**Measured on test pictures:** silhouette match with the original picture **0.90** for a stud-style fish and a stud-style tree after auto-polish (1.0 = identical). Tree mode on the blue stud tree: **0.90** in the house style (Hunyuan3D-2.1 scan, 38 parts), **0.86** / **0.85** as classic studs with Hunyuan3D-2.1 / TRELLIS (21 parts).

---

## 🎨 How to use

### From a picture (best for 1:1)
1. **Projects → New**, pick a **Roblox style** (e.g. *Studs*). If your picture has studs on every side, set **Surface → Studs everywhere**.
2. Click **+ Image** (or drag your picture onto the 3D view).
3. Type what it is in **What to make** (e.g. `red race car`) and anything special in **Notes**.
4. Click **🖼 Build from my image**. It removes the background, scans in 3D, matches the camera, builds, auto-polishes, takes colors from your picture and exports.
5. **Vs picture** shows the comparison any time. **✨ Auto-polish** and **Colors from picture** can be run again after manual edits.
6. Click **Export Roblox** and drag the file into Roblox Studio (or **File → Insert from File**).

### From a text prompt
Type a subject (e.g. `Undead Skeleton Horse`) → **▶ Run pipeline** (pictures → plan → 3D scan → build → polish → export).

### Many pictures at once
**Projects → Batch import folder…** → paste a folder path. Each picture becomes a project and gets scanned; when the free quota runs out, click **Resume scans** later.

### Edit by hand
It's a full little block editor: click parts, **W/E/R** to move/rotate/resize, **Shift** for free movement, **F** focus, **Del**, **Ctrl+D**, **Ctrl+Z / Ctrl+Y**, drag parts between groups in the outliner, **Roblox snap** to tidy everything to the style's rules.

---

## 🤖 Best quality: build with Claude Code

Claude builds noticeably better than free models, and through [Claude Code](https://claude.com/claude-code) it needs no API key.

```bash
npm run mcp:install
```
Keep BlockForge open, start a **new** Claude Code session and say:

> *Use blockforge: open my project, read the build guide, measure the scan with mesh_slices, count the studs in the picture, build it, run polish_model and colors_from_picture, check with render_vs_picture and fix what's red or blue, then export to Roblox.*

<details>
<summary>All 28 MCP tools</summary>

`get_build_guide` · `new_project` · `set_style_preset` · `set_surface_style` · `generate_references` · `generate_part_reference` · `generate_mesh` · `set_mesh_transform` · `list_references` · `view_reference` · `get_model` · `add_parts` · `update_parts` · `delete_parts` · `mirror_part` · `duplicate_part` · `clear_model` · `roblox_snap` · `render_views` · **`render_vs_picture`** · **`polish_model`** · **`colors_from_picture`** · `render_comparison` · `mesh_slices` · **`tree_skeleton`** · **`tree_template`** · `blockify_mesh` · `export_roblox`

**Claude Desktop:** add `{"mcpServers": {"blockforge": {"command": "node", "args": ["<folder>/mcp/mcp-server.js"]}}}` to `claude_desktop_config.json`.
</details>

### 🌳 Trees (tree mode)
Generic slicing turns a tree into a lumpy pile of blocks. When the subject is a tree, bush or plant (or you call `get_build_guide` with `tree: true`), the build guide switches to tree rules:

> *Use blockforge: open my tree project, generate_mesh with backend hunyuan21, read the build guide, run tree_skeleton, build the trunk/branches/canopy from it, count the studs on each leaf block in the picture, run polish_model and colors_from_picture, check render_vs_picture, export.*

`tree_skeleton` voxelizes the scan and returns:
- **wood vs leaves** — split by the color of the trunk base vs the crown, so dark-green trunks with purple leaves work too (falls back to shape when both are one color); a flat ground plate under the scan is ignored;
- **trunk axis** — center and width per height, plus **trunk sections** to build as stacked boxes;
- **branches / roots** — straight segments (start → end, length, thickness, tilt) with a ready-made rotated box for each (bent branches are split until each piece is straight);
- **canopy clusters** — box-like groups of leaf voxels (k-means, the count chosen by how well boxes fill them) with bounds, fill ratio and color;
- **accents** — flowers, fruit and light leaf plates on the canopy.

`add: true` also drops a draft of all those boxes into a `Tree` group. Rules: one box per trunk section, one rotated box per branch (`roblox_snap` with `keep_tilt: true` keeps their angles in classic studs style), 1–3 layered slabs per canopy cluster, stud counts from the picture.

### 🏠 House style (the game's own trees)
Preset **Roblox — House style** (or surface **House**) builds like the game's 50 hand-made trees (measured in `training/STYLE.md`):
- **Export:** every Part is `SmoothPlastic` + a Roblox **MaterialVariant** from the "2022" pack (`2022 Small Universal` by default, `2022 Small Stud` for trunks/branches/roots, `2022 Weld` for balls; set per part with `variant`), plus **4 Decals** on Front/Back/Left/Right (`rbxassetid://127473043565552`, black, 85 % transparent) for the soft shading. No Studs surfaces. The variants must exist in your place's `MaterialService` (folders with the "2022" pack). In a place without them the parts fall back to plain SmoothPlastic; the decals still show.
- **Geometry:** free sizes and organic tilts. `roblox_snap` does nothing in this style. Trunks are bent, tapering segments; roots are flat boxes tilted ~38°; each canopy blob is a core box plus 2–6 face plates with the same rotation (the "pillow" look).
- **Templates:** `tree_skeleton` lists the closest of the 50 trees (by shape and colors). `tree_template` outlines one or imports it scaled to the scan (`add: true`). They are read from `training/studio-trees/`.

### 🧊 Which 3D scan model?
| Backend (Settings → 3D scan model) | Space | Notes |
|---|---|---|
| `trellis` (default) | trellis-community/TRELLIS | fast (~20 s), soft/blobby shapes |
| `trellis2` | microsoft/TRELLIS.2 | more detail, two calls |
| `hunyuan3d` | tencent/Hunyuan3D-2 | shape + texture |
| `hunyuan21` | tencent/Hunyuan3D-2.1 | **sharpest for stud builds** — separate blocks, studs and flowers survive; PBR texture. Takes 2–4 min and asks for **270 s** of ZeroGPU, so it needs an HF token with enough daily quota (anonymous users may not request that much). Its ground shadow comes out as a thin plate, which BlockForge cuts off automatically. |
| `sam3d` | dev-bjoern/sam3d-objects-mcp | Meta SAM 3 + SAM 3D Objects (the official facebook/sam-3d-objects Space is gated). Segments `SAM3D_PROMPT` (default `object`) in the original picture itself, returns a GLB. Also asks for 270 s of ZeroGPU. Spaces that only return a Gaussian-splat PLY (e.g. fayyazio/sam3d-objects-gradio) are not supported — a splat has no surface to voxelize or texture. |

`generate_mesh` takes an optional `backend` to try another model for one scan without changing Settings.

---

## 🎯 How the "almost 1:1" works

1. **Cut out** the subject so floors and skies never end up in the model.
2. **3D scan** the cut-out. BlockForge fixes TRELLIS's linear-color texture so colors stay true.
3. **Match the camera** — renders the scan at many angles and lens widths until its silhouette matches your picture (typically 0.90+), then turns the scan so your picture's view is the model's front.
4. **Measure** — `mesh_slices` gives exact extents per height; stud counting gives exact part sizes.
5. **Build** with real Roblox parts, keeping tilted parts tilted.
6. **Verify** with *Vs picture* from the matched camera.
7. **Auto-polish** — a local optimizer moves/resizes/tilts every part to maximize the match with your picture (weighted highest) and the scan's front, back, left, right and top, with a penalty for drifting from a clean design.
8. **Colors** — each material gets its real lit color from your picture; tiny details keep their designed colors.

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| "No editor open" | Keep the BlockForge browser tab open (it can be in the background) — it does the 3D rendering. |
| "ZeroGPU quota exceeded" | Free Hugging Face accounts get a few scans per day (PRO: 40 min/day). Add your token; existing scans are reused; batch scans resume later. |
| Gemini "quota exceeded" / 503 | 20 free requests per day per model — BlockForge switches models automatically. Or build with Claude Code. |
| Scan faces the wrong way | 3D scan panel → **Auto** or **⟳ 90°**. *Vs picture* re-aligns automatically. |
| Pollinations slow / 402 | The anonymous limit is 1 picture per 45 s. Use your own picture or the Hugging Face FLUX option in Settings. |
| `start.bat` closes immediately | Install Node.js LTS from [nodejs.org](https://nodejs.org) and run it again. |

---

## 📁 Inside

```
start.bat / start.sh      launchers (install dependencies, create .env, open the app)
install.ps1 / install.sh  one-line installers / updaters
server/                   local server: API, AI pipeline, Roblox rules, 3D scan, batch queue
public/                   the editor (three.js): rendering, picture matching, auto-polish, .rbxmx export
mcp/mcp-server.js         MCP server for Claude Code / Claude Desktop
projects/                 your work (local only)
```

## 🙏 Credits

[three.js](https://threejs.org) · [TRELLIS](https://github.com/microsoft/TRELLIS) · [Hunyuan3D-2 / 2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) · [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) · [BRIA RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0) · [Gradio](https://www.gradio.app) · [Hugging Face](https://huggingface.co) · [Pollinations](https://pollinations.ai) · [Google Gemini](https://ai.google.dev) · [Anthropic Claude](https://www.anthropic.com)

> ⚠️ BRIA RMBG-2.0 and Hunyuan3D-2.1 are licensed for **non-commercial** use (Hunyuan: Tencent Hunyuan Non-Commercial License) — check its license before commercial projects. The models you make are yours; check each service's terms for the pictures you use.

## 📄 License

[MIT](LICENSE) © zielonyxiom — free to use, change and share.
