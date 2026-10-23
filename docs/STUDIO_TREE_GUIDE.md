# Building trees in Roblox Studio (how the concept trees and bundles were made)

This is the exact method used for the knight, Erdtree, rocket, teapot, Halloween/Sea/Winter bundles, etc.
An agent with the **Roblox Studio MCP** (`execute_luau`, `screen_capture`, `list_roblox_studios`) can follow it 1:1.
Trees are built directly in Studio with Luau scripts. No BlockForge scan is needed for these.

## Connections (MCP servers) and the project

| Connection | What for | How to get it |
|---|---|---|
| **Roblox Studio MCP** (`mcp__Roblox_Studio__*`) | **Main tool for trees.** `execute_luau` builds in Studio, `screen_capture` checks visually, `list_roblox_studios`, `get_studio_state` | Studio → Assistant settings → enable the MCP server; Studio must be open with "MTF BUILD PLACE.rbxl" |
| **BlockForge MCP** (`mcp__blockforge__*`) | Picture → model pipeline (scan, mesh_slices, build, render_vs_picture, export_roblox / export_studio) | `npm run mcp:install` (registers `node mcp/mcp-server.js`); run `start.bat` so the editor is open at http://localhost:5177 |
| Blender MCP | Only for mesh work BlockForge can't do | optional |

- **Picture → tree (user gives an image):** BlockForge flow. `new_project` → `generate_mesh` (often out of free HF quota: build without a scan) → `mesh_slices` → `add_parts` → `polish_model` → `render_vs_picture` → fix → `export_studio` → run the Luau in Studio with `execute_luau`.
  Rules: `docs/TREE_DESIGN_RULES.md`, house style `training/STYLE.md`, templates `training/studio-trees/`.
- **Idea → tree (concept trees, bundles):** this guide. Build directly in Studio with TreeKit (faster and better for object/creature trees).
- **Memory:** keep a list of the user's corrections (section 5) and add every new one. The user hates repeated mistakes.

## How I work (follow the same loop)

1. Say the idea in one line, check it isn't a repeat, pick a ground spot.
2. Build the whole tree in one script, then audit.
3. Fix the audit to 0/0/0/0, take a screenshot, and judge it honestly: silhouette readable? back side done? base scene? messy?
4. Fix what looks bad (rebuild the part, don't patch over it), rescale, back it up.
5. Short status to the user after each tree or pack. On new feedback: fix it, then add the lesson to section 5 / memory.
6. If Studio disconnects (`No Roblox Studio instances`), wait and `list_roblox_studios` again. Trees already built stay; re-verify with an audit loop over all of them.

## 0. Setup (once per Studio session)

1. `list_roblox_studios`: pick "MTF BUILD PLACE.rbxl" and use its `studio_id`. It changes when Studio restarts, so list again if a call fails.
2. All `execute_luau` calls use `datamodel_type: "Edit"`. Play mode blocks Edit; wait until it is stopped.
3. Three ModuleScripts must exist in `ServerStorage`. They are already in the place. If one is missing, create it from this repo:
   - `ServerStorage.TreeKit` from `studio/TreeKit.lua`: parts, segments, tubes, bezier, octagons, blobs.
   - `ServerStorage.TreeAudit` from `studio/TreeAudit.lua`: the quality gate (coplanar/hidden/float/thin) plus `fix` and `attach`.
   - `ServerStorage.TreeKitExtras` from `studio/TreeKitExtras.lua`: pillow, roots2, bark, octSpots, topSpot, shard, seat, rescale, finish, look.

   To install one: `local m=Instance.new("ModuleScript") m.Name="TreeKitExtras" m.Source=[==[ ...file... ]==] m.Parent=game.ServerStorage`.
4. Always `require(module:Clone())` so edits to the module take effect without restarting Studio.

## 1. House style (never break these)

- Every part: `SmoothPlastic` + MaterialVariant **"2022 Small Universal"** (leaves, objects) or **"2022 Small Stud"** (wood, bark, roots).
  4 black gradient decals per part (`rbxassetid://127473043565552`, Transparency 0.85). `K.part` does all of this.
- **Never Neon**, not even for fire or lightning. Glow = bright yellow/orange/green colors.
- Glass = a normal part with `{decals=false}` and Transparency 0.6–0.8.
- Minimum part thickness 0.2. No thin strips.
- No coplanar faces (rotated stud textures flicker), no floating parts, no parts hidden inside others.

## 2. Workflow per tree

1. **Pick an original concept.** First list what already exists: `workspace._toSort.Trees`, `ServerStorage.TreeDrafts/TreeRemoved/TreeBackups_*`, and `workspace.Bundle_*`. **No repeats** (Mushroom, Crystal, Kraken, Lantern, Moon, Christmas, etc. already exist).
2. **Find free ground.** Raycast down at the planned x/z: ground is y = 0.67 on the baseplate. Rows used so far:
   x=44 (concept trees), x=70 (Halloween/Sea), x=96 (Winter). Space trees about 20–26 studs apart.
3. **Write one `execute_luau` script** that builds the whole tree (template below), ends with `X.finish(ctx)` and returns the audit string.
4. **Read the audit:** `coplanar=0 hidden=0 float=0 thin=0` is required.
   - `float>0`: something only touches, or has a gap. Overlap pieces by about 0.12–0.2 (never just touching), or move the named parts. `X.seat(m)` handles props standing on the ground.
   - `coplanar>0`: run the loop `for _,r in A.coplanar(m) do r[1].Size+=axis*0.1 end` (see the clean() snippet below).
5. **Look at it.** Run `X.look(model, yawDeg, dist, height)` then `screen_capture` (one at a time). Check front, back and side.
   If the capture is black, Studio is minimized: ask the user to bring it to the front.
   **After captures always set** `workspace.CurrentCamera.CameraType=Enum.CameraType.Fixed`.
6. **Size:** bundle trees are about **19** studs tall, normal trees 15–17. Use `X.rescale(m,height,Vector3.new(x,0,z))`, which scales the whole model.
   **Never resize individual parts to fit.**
7. **Backups:** clone the finished tree into `ServerStorage.TreeBackups_Concept5` or `ServerStorage.Bundle_<Name>_Backup`.
8. Tell the user to **save the place** (File → Save). Nothing persists otherwise.

## 3. Script template

```lua
local X=require(game.ServerStorage.TreeKitExtras:Clone()) local K=X.K
local H,S=X.hex,X.shade                       -- hex color, shade(color,factor)
local O=Vector3.new(44,0.67,1500)             -- ground point of the tree
local ctx=K.new("MyIdea_Tree_BlockForge",O)   -- deletes old copy in workspace (NOT inside Bundle_* folders!)
local g=ctx.g                                 -- g("Trunk") makes/gets a sub-model group
local W={var=K.WOOD}
local function v(x,y,z) return O+Vector3.new(x,y,z) end

X.roots2(g("Roots"),O,1.8,H("#5a3a24"),6,1.1)             -- curved roots, tips resting on the ground
local tr=K.bezier(v(0,0.5,0),v(1.2,3,0.4),v(-1,6,-0.3),v(0,9,0),6)
local segs=K.tube(g("Trunk"),"Trunk",tr,1.8,1.1,H("#6b4a35"),W)  -- tapered, curved trunk
X.bark(g("Bark"),segs,H("#6b4a35"),H("#5f8a4a"))         -- ridges + knots + moss (no plain trunks!)
X.pillow(g("Canopy"),"Leaves",CFrame.new(v(0,11,0)),Vector3.new(6,3,6),H("#4caf50"),{"top","left","right","front","back"})
-- ... details: fruit, creatures, props, a small scene at the base ...
local res=X.finish(ctx)                                   -- thin fix + audit fix + seat + attach
-- ctx.model.Parent=workspace.Bundle_Winter               -- for bundle trees
X.look(ctx.model,60,24,2) task.wait(0.5)
return res
```

Clean-up snippet for after any manual edit:
```lua
local A=require(game.ServerStorage.TreeAudit:Clone())
local function clean(m) for i=1,2 do A.fix(m) end
  for i=1,8 do local c=A.coplanar(m) if #c==0 then break end
    for _,r in ipairs(c) do r[1].Size=r[1].Size+({Vector3.xAxis,Vector3.yAxis,Vector3.zAxis})[r[2]]*0.1 end end
  X.seat(m) if #A.floating(m)<=6 then A.attach(m) end return A.audit(m) end
```

## 4. Helper reference

| Helper | What it makes |
|---|---|
| `K.part(g,name,cf,size,color,{var=,decals=false})` | one styled part |
| `K.seg(g,name,A,B,w,d,color,{roll=0})` | box from point A to B (ends overlap) |
| `K.tube(g,name,pts,w0,w1,color,o)` | tapered chain through points with joint cubes; returns segments |
| `K.bezier(p0,p1,p2,p3,n)` | points along a curve (trunks, vines, chains, horns) |
| `K.oct(g,name,center,r,h,color)` | octagon prism (4 boxes); discs, rings, pots, tiers |
| `X.pillow(g,name,cf,size,color,faces)` | canopy/creature block with plates on listed faces |
| `X.roots2(g,base,w,color,count,spread,r0,h0,flare)` | **use this for roots**; r0/h0 start them from a pedestal edge |
| `X.bark(g,segs,color,moss)` | bark ridges/knots/moss on trunk segments |
| `X.octSpots(g,name,center,r,h,{0..7},color,size)` | dots/windows/rivets on octagon sides |
| `X.topSpot(...)` | flat plate on a horizontal surface |
| `X.shard(g,base,dir,len,r,color,roll)` | stepped crystal/ice/thorn |
| `X.seat(m)` / `X.rescale(m,h,ground)` / `X.finish(ctx)` / `X.look(m,yaw,dist,h)` | see section 2 |

Recurring tricks:
- **Disc facing sideways** (clock face, lollipop, heart lobe): octagon around the X axis:
  `for i=0,3 do K.part(g,n,CFrame.new(c)*CFrame.Angles(math.rad(45*i),0,0),Vector3.new(t,2*r,2*r*0.4142),col) end`.
- **Flared cone** (gramophone horn, glass dome, bell): panels between profile rings `{offset,radius}`, each panel from ring i to i+1, 12 around. Never separate rings with gaps.
- **Hollow glass** (hourglass, snow globe): 8 transparent panes per tier plus flat glass rings joining the tiers.
- **Striped pole** (candy cane): octagon bands on one axis, alternating radius (stripe 0.05 proud). Never the same radius overlapping in two colors.
- **Wings/petals/fans**: radiating tapered segments (`K.seg` from a root at several angles) with veins and edge dots. Never one flat box.
- **Faces on objects** (totem, pumpkins, trunks): place features on the **outer** plate surface (size/2 + plate thickness), not inside the block.

## 5. Design rules from the user (learned the hard way)

- **Original, no repeats.** Mix object trees (rocket, teapot, clock, anchor, gramophone, snow globe...) with real trees and epic/dark-fantasy trees (Elden Ring style: Erdtree, Scarlet Rot, Haligtree).
- **Not every tree needs a trunk.** Object trees stand big on a creative base: rocket on a launch pad, teapot on an upside-down teacup on a saucer, heart in a terracotta pot, sword in a mossy rock. Short roots can peek out from under the base. **Plain trunks are "ugly"**: when there is a trunk, curve it (bezier) and add bark.
- **Object/creature trees must look like the real thing.** The chess knight = a real horse head (coat, mane, blaze, eyes, muzzle) on a base in the same palette. A giant clam = a huge open clam with a pearl, not small with kelp. **No decorative leaves** on butterflies, clocks, balloons, etc.
- **No empty trees.** Every tree gets a small ground scene (rocks, flowers, props, creatures), plus secondary detail up top. Build it in from the start.
- **Keep it clean, not messy.** Clear silhouette, clean patterns, no random contrasting band (the teal belt on the balloon was rejected), no clutter.
- **Themed packs commit fully.** The Halloween pack must be scary (dark colors, glowing eyes, evil carved faces, skulls, wraiths, ritual circles); cute = removed.
  Bundles: `workspace.Bundle_<Name>` with trees named `<PREFIX>_<Idea>_Tree`, backup in `ServerStorage.Bundle_<Name>_Backup`.
- **Roots** always rest on the ground and taper to points; nothing sunk "cut off".
- **When the user approves a part ("top is 100% perfect")**, only change what they named. If they say a tree was good, don't rebuild it; rescale only.
- **Size:** bundle trees ~19 tall, spaced ~26 apart.

## 6. Existing bundles (for reference / style matching)

- `workspace.Bundle_Halloween`: HW_WitchHat, HW_WraithWillow, HW_Cauldron, HW_SkeletonHand, HW_EvilPumpkin (x=70)
- `workspace.Bundle_Sea`: SEA_Trident, SEA_CoralReef, SEA_GiantClam (x=70). 2 more planned: shipwreck mast with kraken arm, jellyfish lantern
- `workspace.Bundle_Winter`: WIN_FrostCrystal, WIN_GiftTower, WIN_CandyCane, WIN_Snowman, WIN_Gingerbread (x=96)
- Concept trees on x=44, z 1120–1553 (Knight, Bonsai, Balloon, Butterfly, Clock, Erdtree, ScarletRot, Rocket, Teapot, Heart, SwordStone, Hourglass, Raven, Antler, FrenziedFlame, Deathroot, Haligtree, Anchor, Totem, Gramophone, SnowGlobe, Treasure)

Read the source of any of these in Studio to copy a technique.
