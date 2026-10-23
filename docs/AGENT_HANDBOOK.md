# Agent handbook: everything needed to work on this project exactly like the previous agent

Read in this order: **this file**, then `docs/STUDIO_TREE_GUIDE.md` (method + helpers + template), `docs/TREE_DESIGN_RULES.md` (picture-based rules), and `training/STYLE.md` (house style).
Example scripts that built real trees: `studio/examples/`.

## 1. Who the user is and how to talk to them

- Polish; writes fast and casually with typos, usually in English (sometimes Polish). **Answer in the language they write in**, short and clear. Read typos generously ("tres" = trees, "knigh" = knight, "lolipops" = candy canes).
- Makes a Roblox farming game with stud-style plant/tree models. Owns BlockForge (this repo, github zielonyxiom/blockforge).
  Makes reference pictures in ComfyUI + Krea (`C:\Users\serek\Desktop\tosort\ComfyKrea2\Images`) via their own UI BlomboUI.
- Wants **strong, detailed, original, clean** results and gives creative freedom ("be creative", "have your own mind").
  Hates repeated mistakes: every correction goes into memory and section 5 of the guide immediately.
- Gives feedback mid-task. Apply it right away, then continue the task.
- Trees will be sold as **gamepass bundles** (themed packs of 5) plus standalone trees.

## 2. Connections

- **Roblox Studio MCP**: place "MTF BUILD PLACE.rbxl". `list_roblox_studios` gives the `studio_id`; it changes after Studio restarts. Always use `datamodel_type:"Edit"`.
  - `screen_capture` needs a `capture_id` string, and one call at a time. A **black image = Studio minimized**: tell the user, keep building, verify later.
  - Timeouts happen; retry once.
  - After captures, always reset: `workspace.CurrentCamera.CameraType=Enum.CameraType.Fixed`.
  - Studio can disconnect ("No Roblox Studio instances"). Wait, list again, then re-audit all trees.
  - **The user must save the place** (File → Save); remind them after each batch.
- **BlockForge MCP + app**: `npm run mcp:install`, `start.bat` → http://localhost:5177. Used for picture → model.
  Free Hugging Face scan quota runs out after 1–2 scans: don't retry, build without a scan.
- **Memory**: the auto-memory folder for this project (`~/.claude/projects/C--Users-serek-Desktop-RobloxProjects-Modeler/memory/`) is shared by every session opened in this folder. Keep it updated.
- Git: work in a branch or worktree, commit with clear messages, push; never commit `training/` dumps or `.env`.

## 3. The world layout (Studio)

| Where | What |
|---|---|
| `workspace._toSort.Trees` | the user's 50 hand-made game trees (style reference; don't modify) |
| x=44, z 1030–1553 | Fish, Donut, PoisonIvy, Christmas, Oak, Honeycomb (another session's) + 22 concept trees (Knight … Treasure) |
| x=70 | `workspace.Bundle_Halloween` (z 1120–1204), `workspace.Bundle_Sea` (z 1228–1272) |
| x=96 | `workspace.Bundle_Winter` (z 1124–1228, trees 19 tall, 26 apart) |
| x=122 | standalone "simple good trees" row: AutumnMaple 1124, WeepingWillow 1148, Baobab 1172, … continue +24 |
| `ServerStorage.TreeKit / TreeAudit / TreeKitExtras` | build helpers (sources in `studio/`) |
| `ServerStorage.TreeBackups_*`, `Bundle_*_Backup` | backups of finished trees |
| `ServerStorage.TreeRemoved` | trees the user rejected (keep; can be restored) |

Ground (baseplate top) is y = 0.67. Check free ground with a raycast before placing.

## 4. Every rule (from the user's feedback; all still active)

**Quality gate**: `TreeAudit.audit` must say `coplanar=0 hidden=0 float=0 thin=0`.
- SmoothPlastic + 2022 Small Universal / Small Stud variants, 4 gradient decals. **Never Neon** (not even for lightning or fire).
- No coplanar faces even with the same color (rotated stud textures flicker). No floating parts. No parts buried inside others. No thin strips (<0.2). No jagged crossed-square stars.

**Look and design**:
- Build every side; the back gets the same detail.
- Trunk trees: curved trunk (bezier), **bark ridges/knots/moss** (no plain trunks), **roots** that taper to points resting on the ground (`roots2`), trunk tall enough to see.
- Detailed and alive: multi-part leaves, fruit, flowers, creatures, props. Never single plain boxes. Clean colors, not muddy.
- **No empty trees**: every tree gets a small ground scene plus secondary details up top.
- **Keep it clean, not messy**: a clear silhouette and clean patterns. No random contrasting bands, no clutter, no off-theme filler.
- **Original, no repeats**: check existing trees first.
- **Object/creature trees look real** (the knight is a real horse head, a clam is a huge clam with a pearl). No decorative leaves on them. Their base matches their palette.
- **Not everything on a trunk**: object trees stand on creative bases (launch pad, teacup + saucer, flower pot, mossy rock, sand mound, grave mound).
- **Shapes not rectangles**: wings/petals/fans are radiating tapered segments with veins + border dots.
- **Themed packs commit fully** (Halloween = scary: dark colors, glowing eyes, evil faces, skulls, wraiths).
- **Size**: bundle trees ~19 tall (spaced ~26). Standalone ~15–17. Change size only by rescaling the whole model (`X.rescale`), never by resizing parts.
- When the user approves something ("100% perfect", "was good"), **don't touch it**; change only what they named.
- Mix styles: object trees, real-species trees, epic/dark fantasy (Elden Ring: Erdtree, Scarlet Rot, Haligtree, Frenzied Flame), shapes.

## 5. Bugs I hit and their fixes (check these first)

| Symptom | Cause | Fix |
|---|---|---|
| audit `float` = many parts | stacked pieces only touch (or gap) | overlap ~0.12–0.2; extend ropes/stems/vines into both parts; sink ground props 0.2 |
| props on the ground count as floating | the floating check only seeds from the lowest point | `X.seat(m)` (sinks ground-standing clusters slightly) |
| model floats after rebuild | ground raycast hit the old model's canopy | destroy the old model **before** raycasting (exporter fixed) |
| coplanar after a fix | equal-size neighbours | loop `r[1].Size += axis*0.1` (clean() snippet) |
| stripes flicker ("bugged") | same-radius colored segments overlapping | octagon bands, alternate radius (proud stripe), one axis |
| ring of separate glass/brass pieces | rings don't touch | panels spanning ring i → i+1 (closed surface) + joining rings |
| rescale made the tree huge | `GetBoundingBox` box was rotated | measure height with a world-axis box (`X.rescale` does this) |
| old copy still there after rebuild | `K.new` only clears `workspace` | delete the old copy inside `Bundle_*` first |
| object facing wrong way / edge-on | built along x while the view is along z | rotate the group about the ground point (`piv*CFrame.Angles(0,rad(90),0)*piv:ToObjectSpace(p.CFrame)`) |
| face features invisible | placed inside the pillow plates | put them at size/2 + plate thickness (~0.55 out) |
| parts sunk/"cut off" roots | buttress/slab roots under the ground | `roots2` only |
| screenshot black | Studio minimized | ask the user to restore the window; audits still work |

## 6. Typical session flow

1. `list_roblox_studios`, then audit all trees in the area you will work on (loop over a folder, print `A.audit`).
2. Take the user's request, pick concepts (no repeats), state them in one line each.
3. Per tree: build script, audit, fix to 0/0/0/0, screenshot (front + back), judge, fix, rescale, backup, set the camera to Fixed.
4. After each tree or pack: a short status in their language (what was built, where, audit clean, what's next) plus a reminder to save the place.
5. New lesson from the user goes to memory (`tree-design-lessons.md`) and to this file and the guide.
6. Commit the repo changes (guides, helper sources) and push.
