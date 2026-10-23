# Tree design rules

The rules every BlockForge tree follows. The builder loads this file at startup (get_build_guide and the
AI builder), so edit it to change how trees are built. The numbers come from the game's 50 hand-made trees
(`training/analysis/`, `training/STYLE.md`) and from the owner's feedback.

## The goal
A tree that looks hand-made for the game: simple, chunky, clean and detailed, and good from EVERY side.
Simple means few, big, clear shapes. Detailed means designed little elements on top of those shapes.

## Workflow (every tree)
1. **Base it on a real tree.** `tree_skeleton` lists the closest of the game's trees, and `tree_template` shows
   how that tree is built. Start from that tree or an earlier build, then design on top with your own judgment.
   Never copy blindly, and never start from nothing.
2. **Design in the round.** Plan the canopy blobs, branches, roots and details for the front, back, left and right
   before placing parts. The picture shows one side; you design the other three.
3. **Build:** trunk → roots (`tree_roots`) → branches → canopy blobs (core + plates) → details (`add_detail`) →
   shades (`vary_shades`).
4. **Check:** `check_geometry` (fix every CROSSING / POKE / HIDDEN / Z-FIGHT), `check_sides`, `style_check`,
   `render_vs_picture`, and `render_views` front/back/left/right. Fix, then check again.
5. **Ship:** `export_studio` (build it in Studio) or `export_roblox` (.rbxmx).

## Rules (DO)
**Shape**
- The canopy starts at ~55% of the height (usual 42–64%). Leave ~40% of the height as bare trunk so the trunk
  and roots read.
- Footprint: about 0.85 as deep as it is wide (usual 0.71–0.94). The canopy has real depth.
- The canopy is 2–5 blobs: a big top blob plus smaller ones lower down, offset sideways AND toward the back.
  Each blob has its own yaw and a 2–15° tilt.
- Every blob = a core box + 3–6 face plates at the core's rotation, ~1.0–1.2 thick, covering ~80% of a face and
  sticking out ~0.5. Put plates on the back and the sides too, not only the front.
- Trunk: 3–6 stacked segments, each ~0.94× as wide as the one below, each turned 3–15° so it bends a little.
  Segments overlap 10–30% vertically, and only vertically.
- Branches: 2–4 thinner segments that start inside the trunk and end inside a blob. Spread them around:
  left, right AND back.

**Roots**
- Every trunk gets roots: `tree_roots` (default = the Sunflower roots: a ring of collar blocks and 4–6 flat
  roots that taper to a point on the ground). Roots go all around, not just toward the camera.
- If the picture shows a stepped base or a pot, build that, and still add short Sunflower roots unless it's a pot.

**Details (they make it alive)**
- Use designed details from `add_detail`, never a single plain box: leaf, sprig, fruit, flower, crystal,
  studded_plate, ornament, lantern, spot, drip, star.
- 8–20 details per tree, spread ALL AROUND with `scatter`. Count the back: it needs about as many as the
  front (check_sides reports front/back).
- Details sit on top of surfaces (normal = outward), in groups of 1–3, at different heights.

**Color**
- 2–4 main colors: a dark saturated trunk (value ~0.4), a bright saturated canopy (value ~0.6), plus 1–2
  strong accents.
- Use `vary_shades` (±3–5%) on big canopies and trunks so they aren't flat. The gradient decals do the
  shading, so don't paint shadows.
- Take colors from the picture, but brighten muddy ones: Roblox renders darker than AI pictures.

**Style (house)**
- SmoothPlastic + MaterialVariant (Small Stud for wood, Small Universal for the rest, Weld for balls) + 4
  gradient decals (export does this). Free sizes, organic tilts.

## Anti-rules (DON'T)
- ❌ Don't let a part go through another part and come out the other side (a vine through a trunk corner, a
  branch through a plate). Sink a part into another from ONE side only.
- ❌ No flush coplanar faces (z-fighting flicker). Offset by ≥0.03 or make one clearly bigger.
- ❌ No parts hidden completely inside others (invisible, wasted).
- ❌ No parts that barely poke out (<0.15): push them in or out properly.
- ❌ No strips or lines thinner than 0.18 (grooves, outlines, tiny stripes): they read as glitches.
- ❌ No flat, empty or copy-paste back side. No canopy that is a thin wall facing the camera.
- ❌ No single-box "details" (a flat square for a leaf, a cube for a fruit). Use `add_detail`.
- ❌ No muddy or greyed colors, and no more than ~5 colors.
- ❌ No staircases of small boxes for a slanted branch: use one rotated box per segment.
- ❌ No roblox_snap in house style (it destroys tilts and free sizes).
- ❌ No giant part counts for their own sake: 40–120 parts is the usual range.

## Done means
- check_geometry: clean (or only crossings you meant on purpose, like crossed bones).
- check_sides: back/left/right covered, details on the back too.
- style_check: no ✗.
- render_views back/left/right look as finished as the front.

## Concept trees (objects / creatures) — lessons from the user
- No repeats: check the game's existing trees first (Mushroom, Crystal, Kraken, Lantern, Moon, Windmill, Honeycomb, Whale, Rook... are taken).
- An object/creature tree must look like the real thing (a chess knight = a real horse head with mane, eyes, muzzle), not a leafy imitation. No decorative leaves on butterflies, clocks, balloons.
- The base belongs to the piece: same palette and style as the top, wide enough that the top sits inside it (no corners poking out).
- Organic shapes are fans of radiating tapered segments (wings, petals), never one flat box.
- Keep patterns clean: no extra contrasting band, no random shade noise on stripes.
- Roots: curved tapering tubes that end in a point resting ON the ground. Nothing sunk below ground: it looks cut off.
- Stacked discs/bands overlap ~0.12; parts that only touch read as floating and leave gaps.
- Fit the row by rescaling the whole model (Model:ScaleTo around the ground point), never by resizing parts. Measure height with a world-axis box, not GetBoundingBox (it can be rotated).
- Studio helpers: `studio/TreeKitExtras.lua` (pillow, roots2, octSpots, shard, finish) on top of ServerStorage.TreeKit + TreeAudit.
