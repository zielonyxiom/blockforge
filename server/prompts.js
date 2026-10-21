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
- blockify_mesh can drop a voxel version of the scan into a "Blockout" group as a placement guide; delete that group before you finish unless the user wants a voxel look.`;

// Appended when the model is built from a picture (the user's image is the ground truth).
export const PICTURE_RULES = `## Match the picture 1:1 (most important)
The user's picture is the ground truth. The 3D scan only helps with depth and placement — when they disagree, follow the picture.
- COUNT STUDS for exact sizes. In stud-style pictures every stud is 1 stud apart on every face: a face showing 9 studs across and 3 rows is 9 wide × 3 tall. Count each visible part's studs and size it exactly.
- One visible box in the picture = one part. Recreate every one: each canopy/leaf chunk, trunk section, branch, root/foot, flower, leaf, flag, eye, stripe. Don't merge separate boxes into one big block, and don't skip small ones.
- Keep tilted parts tilted at the same angle (branches at 30–45°, leaves, fins). Use rotation, not staircases.
- Copy each part's color from the picture (nearest BrickColor); keep the light/dark variants the picture has.
- Coarse to fine: big masses first, then secondary boxes, then small details.
- After every batch of changes call render_vs_picture and fix the RED (missing) and BLUE (extra) areas. Aim for IoU ≥ 0.85, then keep going on details the silhouette can't show (colors, stud counts, small parts).`;

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
8. Checks: render_vs_picture after the trunk+branches+canopy pass, fix RED/BLUE, then polish_model. If you run roblox_snap mode "studs", pass keep_tilt: true so branches keep their angle.`;

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
List the concrete differences you see, then fix them with tools. Call render_views again to verify, and call finish when it matches. (${roundsLeft} review round(s) left after this one.)`;
}
