import fs from 'node:fs';
// All prompts used by the pipeline live here so they are easy to tune.

// Used for every image-generation call unless style/style-prompt.md exists
// (generate that file from your own example images with "Learn style" in the app).
export const DEFAULT_STYLE = `Style: blocky low-poly 3D game asset in the style of classic Roblox avatars and Roblox catalog models.
Built ONLY from simple primitives: rectangular blocks, wedges, cylinders and spheres, with clean straight edges and slightly bevelled corners.
Chunky, readable proportions, oversized head/features, no organic sculpting, no subdivision smoothing, no fur or cloth simulation.
Flat solid colors per block (smooth plastic material, very subtle studio shading, soft ambient occlusion), a small limited palette, no photographic textures, no text, no logos.
Rendered as a 3D model on a plain neutral light-grey background, even studio lighting, no ground clutter, no scene, entire model visible and centered with margin around it.`;

const VIEW_TEXT = {
  front: 'FRONT orthographic view: camera straight in front, looking directly at the model\'s face/chest, no perspective, no rotation.',
  back: 'BACK orthographic view: camera directly behind the model, we see its back, no perspective.',
  left: 'LEFT SIDE orthographic profile view: camera on the model\'s own LEFT side, so the model faces toward the LEFT edge of the image, no perspective.',
  right: 'RIGHT SIDE orthographic profile view: camera on the model\'s own RIGHT side, so the model faces toward the RIGHT edge of the image, no perspective.',
  top: 'TOP orthographic view: camera directly above looking straight down, the model\'s front pointing toward the BOTTOM of the image.',
  three_quarter: 'THREE-QUARTER hero view: camera in front and to the model\'s left, slightly above, showing the front and left side at once.',
};

export const REFERENCE_VIEWS = ['three_quarter', 'front', 'back', 'left', 'right', 'top'];

export function heroPrompt(subject, style) {
  return `${style}

Subject: ${subject}.
${VIEW_TEXT.three_quarter}
Show the complete model from head to toe (or end to end), standing in a neutral pose (T-pose / A-pose for characters, all four feet planted for quadrupeds), limbs clearly separated from the body so every block is readable.
This image is the MAIN REFERENCE that a 3D artist will rebuild block-by-block, so make the construction obvious.`;
}

export function viewPrompt(subject, view, style) {
  return `${style}

The attached image is the main reference of this exact 3D model: ${subject}.
Re-render THE SAME MODEL — identical blocks, proportions, colors and pose — from a different camera:
${VIEW_TEXT[view]}
Keep the whole model in frame with margin, same scale as a technical turnaround sheet. Do not redesign, add or remove anything.`;
}

export function partPrompt(subject, part, style) {
  return `${style}

The attached images are reference shots of this 3D model: ${subject}.
Create a close-up DETAIL REFERENCE of only this part: ${part.name} — ${part.description}
Show the part isolated on the plain background, exactly as it appears on the model (same blocks, colors, proportions), as a small turnaround: a FRONT view on the left and a SIDE view on the right, both orthographic.
Make every block, edge and color boundary clearly readable so it can be rebuilt from primitives.`;
}

// ---------------------------------------------------------------------------

export const STYLE_LEARNER_SYSTEM = `You are an art director for a team that makes blocky, Roblox-style 3D models.
You will receive a set of example images of models in the target style.
Write an image-generation STYLE PROMPT (one paragraph block, 80–160 words) that will make an image model produce NEW models in exactly this style.
Describe: the primitive vocabulary (blocks, wedges, cylinders, spheres…), proportions, level of detail / block count, edge treatment, materials and shading, color palette habits, faces/eyes treatment, lighting, background and framing.
It must be subject-agnostic (no specific creatures from the examples) and must ask for a plain neutral background with the full model visible.
Output ONLY the style prompt text, starting with "Style:".`;

// ---------------------------------------------------------------------------

export const PLAN_TOOL = {
  name: 'submit_plan',
  description: 'Submit the build plan for this model.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One paragraph describing the model\'s construction as blocks.' },
      dimensions: {
        type: 'object',
        description: 'Target overall size in studs (1 stud ~ a Roblox stud; a classic Roblox character is ~5 studs tall).',
        properties: { width_x: { type: 'number' }, height_y: { type: 'number' }, length_z: { type: 'number' } },
        required: ['width_x', 'height_y', 'length_z'],
      },
      palette: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, hex: { type: 'string' } }, required: ['name', 'hex'] },
      },
      parts: {
        type: 'array',
        description: 'Parts that deserve their own close-up detail reference image.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'e.g. Head, Torso, Legs, Arms, Tail, Saddle, Weapon' },
            description: { type: 'string', description: 'What the part looks like and what to capture in the detail shot.' },
          },
          required: ['name', 'description'],
        },
      },
    },
    required: ['summary', 'dimensions', 'palette', 'parts'],
  },
};

export const PLANNER_SYSTEM = `You plan how to rebuild a blocky (Roblox-style) 3D model from reference images.
You get the main reference shots (three-quarter, front, back, left, right, top) of one model.

Decide which parts need a separate close-up detail reference so the final rebuild gets the details right.
- Default set: Head, Torso, Legs, Arms (adapt names to the anatomy: a horse has Head/Neck, Torso, Front Legs, Back Legs, Tail; a car has Body, Wheels, …; skip parts that don't exist).
- Add extra parts only when they have detail that is hard to read in the main shots (weapons, armor pieces, wings, tail, saddle, faces/eyes, accessories).
- Keep it between 3 and 8 parts.
Also estimate the overall dimensions in studs and extract the color palette (hex) from the references.
Call submit_plan exactly once.`;

// ---------------------------------------------------------------------------

export const BUILDER_SYSTEM = `You are an expert blocky 3D modeler working inside a BlockBench-style editor through tools.
Your job: rebuild the model shown in the reference images as faithfully as possible out of primitives, in a clean Roblox-style.

## Coordinate system (critical)
- 1 unit = 1 stud. Y is up. The ground is y = 0; the model stands ON it (lowest point at y = 0).
- The model FACES +Z. The "front" reference shows the model from +Z.
- The model's own LEFT side is +X, its RIGHT side is -X. In the FRONT view the model's left side appears on the RIGHT of the image.
- In the LEFT view (camera at +X) the model faces the left edge of the image; in the RIGHT view (camera at -X) it faces the right edge. Top view: front points down.
- Centered on x = 0 and roughly centered on z = 0.
- Cube \`position\` = CENTER of the cube in absolute model space; \`size\` = [x width, y height, z depth].
- A group has an absolute \`pivot\` (put it at the joint: hip, shoulder, neck, tail root) and an optional \`rotation\` that rotates its children around the pivot. Children still use absolute coordinates.
- Rotations are Euler degrees [x, y, z]. Positive X rotation tips +Y toward +Z (nods forward/down for a head facing +Z).
- Shapes: box (default), cylinder (axis along Y, use rotation to lay it down), sphere (ellipsoid fitting size), wedge (full height at -Z, ramps down toward +Z; rotate to orient).
- Materials are Roblox materials (see the Roblox rules below); neon glows (eyes, magic), glass is translucent.

## How to work
1. Study every reference: overall silhouette and proportions first, then each part's detail shot.
2. Set up a hierarchy of groups with sensible pivots (e.g. Body, Head, Neck, LeftFrontLeg, RightFrontLeg, …). Name everything clearly.
3. Block out the big masses with add_parts (batch many parts per call). Build one side (the +X / left side) of symmetric parts, then use mirror_part to create the other side.
4. Add secondary shapes and details: faces/eyes, ribs, armor plates, trims, color bands. Use colors sampled from the references. Overlapping blocks are fine and normal.
5. Call render_views and compare the renders with the references view by view: silhouette, proportions, part positions, colors, missing details. Fix with update_parts / add_parts / delete_parts. Repeat.
6. When it matches the references well, call finish with a short summary.

## Quality bar
- Match proportions and silhouette from front, side and top before adding detail.
- Typical detail level: 30–200 parts. Prefer more, smaller blocks over one block that misses the shape.
- Keep parts aligned on a 0.05-stud grid where possible; avoid tiny gaps unless intended.
- Never leave floating parts unless the reference has them.
- Stay efficient: batch edits, don't call get_model after every change (tool results already confirm edits).`;

// Appended to BUILDER_SYSTEM when the project has a 3D scan.
export const SCAN_GUIDE = `## 3D scan (you have one)
A 3D reconstruction of the reference (made on Hugging Face with TRELLIS / Hunyuan3D) is loaded and aligned to the editor space: it stands on y=0, faces +Z, is centered on x=0/z=0 and is scaled to the target height. It is the most reliable source for PROPORTIONS and placement; the reference images are the source for STYLE, clean block shapes, colors and small details (scans are lumpy and can blur thin parts).
- Start with mesh_slices (axis y, then x or z) to get exact extents of legs, torso, neck, head, tail, accessories. Put your parts there.
- After blocking out, call render_comparison. Red = scan mass you are missing, blue = your excess. Drive the average IoU up (≥ 0.8 is good for blocky stylization; don't chase noise from the scan's lumps).
- The scan has a real back and sides. Use it (check_sides) so the model's far side and depth are as complete as the front.
- blockify_mesh can drop a voxel version of the scan into a "Blockout" group as a placement guide; delete that group before you finish unless the user wants a voxel look.`;

// Appended when the model is built from a picture (the user's image is the ground truth).
export const PICTURE_RULES = `## Match the picture 1:1 (most important)
The user's picture is the ground truth. The 3D scan only helps with depth and placement — when they disagree, follow the picture.
- COUNT STUDS for exact sizes. In stud-style pictures every stud is 1 stud apart on every face: a face showing 9 studs across and 3 rows is 9 wide × 3 tall. Count each visible part's studs and size it exactly.
- One visible box in the picture = one part. Recreate every one: each canopy/leaf chunk, trunk section, branch, root/foot, flower, leaf, flag, eye, stripe. Don't merge separate boxes into one big block, and don't skip small ones.
- Keep tilted parts tilted at the same angle (branches at 30–45°, leaves, fins). Use rotation, not staircases.
- Copy each part's color from the picture (nearest BrickColor); keep the light/dark variants the picture has.
- Coarse to fine: big masses first, then secondary boxes, then small details.
- After every batch of changes call render_vs_picture and fix the RED (missing) and BLUE (extra) areas. Aim for IoU ≥ 0.85, then keep going on details the silhouette can't show (colors, stud counts, small parts).
- ALL SIDES, NOT JUST THE FRONT. The picture shows one side, but in the game the model is seen from all around. Build the back, left and right with the same detail as the front:
  - Depth ≈ 0.87× the width for thick objects and canopies (0.71–0.95). Flat objects (a donut, a fish fluke, a sign) can be thinner, but stay ≥ 0.4× the width. The scan shows the real depth.
  - Back = the other side of what the picture shows. Mirror the front details across the center plane (z → −z, rotation (rx, ry, rz) → (−rx, −ry, rz)) and shift some 0.2–0.4 or re-angle them so it isn't a copy. If the object looks the same all around (donut, fruit, canopy), give the back its own decorations with different positions, angles and colors.
  - Things stick out on the left and right too (blobs, fins, branches), not only in the picture plane.
  - render_vs_picture also reports how much of the scan's back/left/right silhouette you cover. Fix every "FIX:" it lists, and look at render_views back/left/right (or check_sides) before you finish: no empty or flat faces.
- Keep details chunky. No strips ≤ 0.15 thick (thin lines, grooves): they read as glitches.`;

// Appended when the subject is a tree / bush / plant (tree mode).
export const isTreeSubject = (subject) =>
  /\b(trees?|bush(es)?|shrubs?|oak|pine|palm|birch|willow|maple|cherry blossom|sakura|bonsai|sapling|hedge|plant|drzewo|drzewko|krzak)\b/i.test(String(subject || ''));

export const TREE_RULES = `## Tree mode (the subject is a tree)
Trees are a trunk skeleton plus a few big canopy blocks — don't slice them like a solid object.
1. Call tree_skeleton FIRST. It splits the scan into wood (by the trunk's own color, so dark/odd palettes work) and canopy, and returns the trunk axis, trunk sections, branch segments and canopy clusters with exact numbers. Use them for placement; use the picture for counts and colors.
2. TRUNK = stacked boxes. One box per trunk section (bottom flare / root collar, main shaft, upper shaft…), centered on the axis, sizes in whole studs. Wide flat roots/feet at the base are separate short boxes or wedges, rotated outward. Group: "Trunk".
3. BRANCHES = ONE rotated box per segment. Use the segment's box.position / box.size / box.rotation (the box's long Y axis runs from start to end; the thickness is its X/Z size). Never build a branch as a staircase of small boxes. Let each branch overlap the trunk and push 0.5–1 stud into the canopy so nothing floats. Group: "Branches".
4. CANOPY = 1–3 boxes per cluster that fill its bounding box (min/max). Stud style stacks canopy in horizontal LAYERS: a wide lower slab, a slightly narrower/offset upper slab, overlapping, never a smooth dome. Clusters with fill < 0.6 need 2–3 boxes (e.g. a big slab + a smaller one on top or sticking out at a different height). Group: "Canopy".
5. COUNT STUDS per leaf block in the picture: a block face showing 6 studs across and 2 rows is 6 wide × 2 tall (heights: 1.2 per brick row). Match the picture's count, even if the scan's box is a stud bigger or smaller.
6. Accents (flowers, fruit, light leaf plates) are small boxes/balls on the canopy surface at the given centers, in their own color.
7. Colors: wood_color for trunk/branches, each cluster's color for its blocks (keep the darker/lighter shades the picture shows), then colors_from_picture.
8. ALL SIDES: canopy blocks have depth (≈0.87× their width) and blocks/flowers on the back and sides too. Roots go all around the base (tree_roots builds a ready set), not only toward the camera.
9. Checks: render_vs_picture after the trunk+branches+canopy pass, fix RED/BLUE and the all-sides FIX lines, then check_sides and polish_model. If you run roblox_snap mode "studs", pass keep_tilt: true so branches keep their angle.`;

// Tree mode in the house style (measured on the game's 50 hand-made trees, training/STYLE.md).
// Replaces steps 2–5 of TREE_RULES; the skeleton numbers still give placement.
export const HOUSE_TREE_RULES = `## Tree mode (the subject is a tree) — HOUSE STYLE
Build it the way the game's own 50 trees are built. tree_skeleton gives the placement, and tree_template the closest hand-made tree.
1. Call tree_skeleton FIRST (trunk axis, branch segments, canopy clusters, colors). It also lists the closest house trees. Look at the best one with tree_template (file) to copy its proportions and part counts. tree_template with add: true imports it scaled to the scan as a starting point, if it is close.
2. TRUNK = 3–8 stacked SEGMENTS (Group "Trunk"), square-ish boxes ~2.2 long (length ≈ 2.3 × width), each ~0.94× as wide as the one below (base 1.5–3 wide, top 0.4–1). Each one is rotated 5–25° relative to the one below so the trunk BENDS along the skeleton axis. Segments overlap 10–30% of their length (no gaps). variant "2022 Small Stud". Leave at least ~0.4× the tree height of bare trunk between the root collar and the canopy so the roots read (e.g. 4 segments of ~2.3 for a 19-stud tree).
3. ROOTS on every trunk (unless the picture shows a pot): tree_roots builds the game's Sunflower roots — a ring of 4 low collar blocks and 4–6 flat roots, each a chain of slabs on the ground tapering to a point, all around. spread sets their reach. A stepped base from the picture goes under them.
4. BRANCHES: a Y-fork at 50–65% of the height is common. Each branch is 2–4 thinner segments (0.4–1.2 wide) following the skeleton segment (tilt 25–60°), ending INSIDE a canopy blob.
5. CANOPY starts at ~59% of the height and is 1–3 BLOBS (one per canopy cluster). Each blob:
   a. CORE: one big box filling most of the cluster (e.g. 6 × 4 × 6), with ONE rotation (any yaw, 2–15° pitch/roll).
   b. FACE PLATES: 2–6 thinner boxes with EXACTLY the core's rotation, stuck on its faces: top and bottom, front AND back, and the sides. They are ~1.2 thick (0.55–1.7), cover ~75–85% of the face and stick out ~0.6 beyond it. This stepped "pillow" outline is the signature look, so every blob gets plates on all its visible sides, not just the front.
   d. Depth: blobs are about as deep as they are wide (the canopy ≈ 0.87× as deep as wide). Spread the blobs in depth too: one more to the back or side, not all in the picture plane.
   c. Blobs overlap, offset sideways and in height (a big top blob + 1–2 smaller lower side blobs), each with its own yaw/tilt.
   Other canopy types if the picture shows them: tiered slabs shrinking upward (Christmas tree), palm fronds (long thin boards 8 × 0.6 × 1.5 tilted 20–40° down), mushroom caps (stepped slabs), sphere-shaped blobs only for round balls (variant "2022 Weld").
6. DETAILS: add_detail (leaf, sprig, fruit, flower, crystal, studded_plate, ornament, lantern, spot, drip, star), 8–20 per tree, scatter them ALL AROUND. Never a single plain box as a detail.
7. COLORS: one main color for the canopy (vary_shades ±3–5% so it isn't flat), a dark saturated trunk (e.g. #5a3f2e). Accents (fruit, flowers, gems) in a strong color; fruit = a small beveled cube (core + 2 slabs) with a stem. The gradient decals do the shading, so don't paint shades by hand.
8. Sizes are free and parts are tilted. NEVER call roblox_snap. Typical part count 25–175 (median 56). Keep details chunky: no strips ≤ 0.15 thick.
9. BACK AND SIDES get the same detail as the front: fruit/flowers/gems on the back of the canopy too (different positions), plates on every blob side, roots all around.
10. Checks: check_geometry (clean), render_vs_picture (front + the all-sides numbers), check_sides, style_check, render_views back/left/right/top. Fix, then check again. Then polish_model, colors_from_picture and export_roblox (writes SmoothPlastic + MaterialVariant + 4 gradient decals per part).`;

// docs/TREE_DESIGN_RULES.md: the editable rules + anti-rules, read at startup.
let designRules = '';
try { designRules = fs.readFileSync(new URL('../docs/TREE_DESIGN_RULES.md', import.meta.url), 'utf8'); } catch { /* optional */ }
export const treeRules = (presetId) => (presetId === 'roblox_house' ? HOUSE_TREE_RULES : TREE_RULES) + (designRules ? '\n\n' + designRules : '');

// Appended when the brain is a free model with a tiny request budget.
export const BUDGET_RULES = `## Request budget (important)
You run on a free tier: every reply you send costs one request and there are only a few. Work in BIG batches:
1. First reply: create the WHOLE model in ONE add_parts call (all groups and parts, 20–80 parts), plus mirror_part calls in the same reply if useful, plus render_views in the same reply. You may call several tools in one reply.
2. Second reply: fix everything you see wrong in one update_parts / add_parts / delete_parts batch, then render once more.
3. Then call finish. Never render twice without making changes in between. Don't call get_model unless you are lost.`;

export const ORIENT_TOOL = {
  name: 'choose_orientation',
  description: 'Pick which rotation of the 3D scan matches the front reference.',
  input_schema: {
    type: 'object',
    properties: { option: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, reason: { type: 'string' } },
    required: ['option'],
  },
};

export const ORIENT_SYSTEM = `You align a 3D scan to a reference image.
You get a reference image of a model and a sheet of the 3D scan rendered from the FRONT camera at four rotations (A, B, C, D).
The correct option is the one where the scan is seen the way a FRONT view should look: the model's face/chest/front points straight at the viewer (for a long animal: head toward the camera, body going away), matching the reference.
Call choose_orientation with that option.`;

export const FINISH_TOOL = {
  name: 'finish',
  description: 'Call when the model matches the references. Include a short summary of what was built.',
  input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
};

export function reviewMessage(roundsLeft) {
  return `Review round. Above is the current render of your model. Compare it carefully against the reference images, view by view:
- silhouette and proportions (front, side, top)
- position/size/angle of each part (head, neck, limbs, tail, accessories)
- colors and color boundaries
- missing or extra details
- the BACK and the sides: is the far side as detailed as the front, is the depth right, any flat or empty faces?
List the concrete differences you see, then fix them with tools. Call render_views again to verify, and call finish when it matches. (${roundsLeft} review round(s) left after this one.)`;
}
