// Roblox-specific knowledge: style presets (image style + build rules), the
// BrickColor palette, materials, and the "Roblox snap" clean-up pass.
//
// Sources for the rules: Roblox DevForum "Roblox - Classic Building Guide"
// (FormFactor: Brick 1.2 / Symmetric 1 / Plate 0.4 studs, 1-stud X/Z steps, studs↔inlets),
// BrickColor table (htmlcolorcodes.com/roblox-color-codes), and 2026 style trend
// notes (low-poly is the most common style; bright stylized "anime game" looks are rising).

// ---------------------------------------------------------------------------
// BrickColor palette (name → hex). The first block is the classic core palette.
// ---------------------------------------------------------------------------
export const CLASSIC_BRICKCOLORS = {
  'White': '#f2f3f3', 'Institutional white': '#f8f8f8', 'Light stone grey': '#e5e4df', 'Medium stone grey': '#a3a2a5',
  'Dark stone grey': '#635f62', 'Black': '#1b2a35', 'Really black': '#111111', 'Bright red': '#c4281c',
  'Bright orange': '#da8541', 'Bright yellow': '#f5cd30', 'Bright green': '#4b974b', 'Dark green': '#287f47',
  'Earth green': '#27462d', 'Bright blue': '#0d69ac', 'Medium blue': '#6e99ca', 'Pastel Blue': '#80bbdb',
  'Bright violet': '#6b327c', 'Reddish brown': '#694028', 'Brown': '#7c5c46', 'Nougat': '#cc8e69',
  'Brick yellow': '#d7c59a', 'Sand green': '#789082', 'Sand blue': '#74869d', 'Sand red': '#957977',
  'Dark red': '#7b2e2f', 'Light yellow': '#f9e999', 'Gold': '#dcbc81', 'Silver': '#9ca3a8',
};

export const BRICKCOLORS = {
  ...CLASSIC_BRICKCOLORS,
  'Grey': '#a1a5a2', 'Light green (Mint)': '#c2dab8', 'Light reddish violet': '#e8bac8', 'Light orange brown': '#cb8442',
  'Med. reddish violet': '#c470a0', 'Earth orange': '#624732', 'Dark grey': '#6d6e6c', 'Medium green': '#a1c48c',
  'Lig. Yellowich orange': '#f3cf9b', 'Dark orange': '#a05f35', 'Light bluish violet': '#c1cade', 'Light blue': '#b4d2e4',
  'Light red': '#eec4b6', 'Medium red': '#da867a', 'Light grey': '#c7c1b7', 'Br. yellowish orange': '#e29b40',
  'Bright bluish green': '#008f9c', 'Earth yellow': '#685c43', 'Bright bluish violet': '#435493', 'Medium bluish violet': '#6874ac',
  'Med. yellowish green': '#c7d23c', 'Med. bluish green': '#55a5af', 'Light bluish green': '#b7d7d5', 'Br. yellowish green': '#a4bd47',
  'Lig. yellowish green': '#d9e4a7', 'Med. yellowish orange': '#e7ac58', 'Br. reddish orange': '#d36f4c', 'Bright reddish violet': '#923978',
  'Light orange': '#eab892', 'Dark nougat': '#ae7a59', 'Medium orange': '#e09864', 'Sand yellow': '#958a73',
  'Earth blue': '#203a56', 'Sand violet': '#877c90', 'Curry': '#d7a94b', 'Fire Yellow': '#f9d62e',
  'Flame yellowish orange': '#e8ab2d', 'Flame reddish orange': '#cf6024', 'Royal blue': '#4667a4', 'Dark Royal blue': '#23478b',
  'Faded green': '#709578', 'Turquoise': '#79b5b5', 'Light Royal blue': '#9fc3e9', 'Rust': '#904c2a',
  'Lilac': '#6b629b', 'Light lilac': '#a7a9ce', 'Bright purple': '#cd6298', 'Light pink': '#dc9095',
  'Light brick yellow': '#f0d5a0', 'Cool yellow': '#fdea8d', 'Dove blue': '#7dbbdd', 'Slime green': '#506d54',
  'Smoky grey': '#5b5d69', 'Parsley green': '#2c651d', 'Steel blue': '#527cae', 'Storm blue': '#335882',
  'Sea green': '#348e40', 'Shamrock': '#5b9a4c', 'Fossil': '#9fa1ac', 'Mulberry': '#592259',
  'Forest green': '#1f801d', 'Cadet blue': '#9fadc0', 'Electric blue': '#0989cf', 'Moss': '#7c9c6b',
  'Sage green': '#b9c4b1', 'Ghost grey': '#cacbd1', 'Plum': '#7b2f7b', 'Olivine': '#94be81',
  'Crimson': '#970000', 'Mint': '#b1e5a6', 'Baby blue': '#98c2db', 'Carnation pink': '#ff98dc',
  'Persimmon': '#ff5959', 'Maroon': '#750000', 'Daisy orange': '#f8d96d', 'Pearl': '#e7e7ec',
  'Salmon': '#ff9494', 'Terra Cotta': '#be6862', 'Cocoa': '#562424', 'Wheat': '#f1e7c7',
  'Buttermilk': '#fef3bb', 'Burgundy': '#883e3e', 'Cork': '#bc9b5d', 'Burlap': '#c7ac78',
  'Beige': '#cabfa3', 'Pine Cone': '#6c584b', 'Fawn brown': '#a0844f', 'Cloudy grey': '#aba89e',
  'Linen': '#af9483', 'Copper': '#966766', 'Dirt brown': '#564236', 'Bronze': '#7e683f',
  'Flint': '#69665c', 'Dark taupe': '#5a4c42', 'Burnt Sienna': '#6a3909', 'Mid gray': '#cdcdcd',
  'Really red': '#ff0000', 'Deep orange': '#ffb000', 'Olive': '#c1be42', 'New Yeller': '#ffff00',
  'Really blue': '#0000ff', 'Navy blue': '#002060', 'Deep blue': '#2154b9', 'Cyan': '#04afec',
  'Magenta': '#aa00aa', 'Pink': '#ff66cc', 'Teal': '#12eed4', 'Toothpaste': '#00ffff',
  'Lime green': '#00ff00', 'Camo': '#3a7d15', 'Lavender': '#8c5b9f', 'Pastel light blue': '#afddff',
  'Pastel violet': '#b1a7ff', 'Pastel blue-green': '#9ff3e9', 'Pastel green': '#ccffcc', 'Pastel yellow': '#ffffcc',
  'Pastel brown': '#ffcc99', 'Royal purple': '#6225d1', 'Hot pink': '#ff00bf', 'Alder': '#b480ff',
};

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// sRGB hex → CIELAB, so "nearest color" keeps the hue a person would expect.
function lab(hex) {
  const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const colorDist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
export function nearestBrickColor(hex, palette = BRICKCOLORS) {
  const c = lab(hex);
  let best = null, bd = Infinity;
  for (const [name, h] of Object.entries(palette)) {
    const d = colorDist(c, lab(h));
    if (d < bd) { bd = d; best = { name, hex: h }; }
  }
  return best;
}

// Roblox Enum.Material values (used by the .rbxmx exporter in the browser too).
export const ROBLOX_MATERIALS = {
  plastic: 'Plastic', smooth: 'SmoothPlastic', neon: 'Neon', metal: 'Metal', glass: 'Glass',
  wood: 'Wood', woodplanks: 'WoodPlanks', slate: 'Slate', concrete: 'Concrete', brick: 'Brick',
  granite: 'Granite', marble: 'Marble', cobblestone: 'Cobblestone', fabric: 'Fabric', grass: 'Grass',
  sand: 'Sand', ice: 'Ice', foil: 'Foil', diamondplate: 'DiamondPlate', corrodedmetal: 'CorrodedMetal',
  forcefield: 'ForceField',
};

// ---------------------------------------------------------------------------
// Rules shared by every Roblox preset (appended to the builder system prompt).
// ---------------------------------------------------------------------------
const COMMON_PALETTE = Object.entries(CLASSIC_BRICKCOLORS).map(([n, h]) => `${n} ${h}`).join(', ');

export const ROBLOX_RULES = `## Roblox rules (this model is exported to Roblox Studio as real Parts)
- Units are Roblox studs (1 stud ≈ 0.28 m). Scale anchors: classic R6 character = 5 studs tall (legs 2, torso 2×2×1, arms 1×2×1, head ~1.2); R15 default avatar ≈ 5.2–5.5 studs; door ≈ 4 wide × 7 tall; rideable mount: back ≈ 3–3.5 studs high; house storey ≈ 10–12 studs.
- Every primitive becomes one Roblox Part: box → Part (Block), cylinder → Part (Cylinder; keep its X and Z size equal, Roblox cylinders are round), sphere → Part (Ball) when all three sizes are equal, otherwise a sphere mesh; wedge → WedgePart. Groups become Models (named), so name groups and parts clearly (Head, LeftFrontLeg, Saddle…).
- Keep it light: props/creatures ≈ 30–150 parts, large builds ≤ 300. No hidden parts buried inside other parts. Nothing thinner than 0.1 stud.
- Characters/creatures: one group per limb with the pivot at the joint (shoulder, hip, neck, tail root) so it can be rigged with Motor6Ds later.
- Colors: pick from the Roblox BrickColor palette (exact hex values): ${COMMON_PALETTE}. Other BrickColors are fine; arbitrary RGB is allowed but palette colors look the most "Roblox".
- Materials map to Roblox materials: plastic (Plastic), smooth (SmoothPlastic), neon, metal, glass, wood, woodplanks, slate, concrete, brick, granite, marble, cobblestone, fabric, grass, sand, ice, foil, diamondplate, corrodedmetal, forcefield. Use Neon only for real glow (eyes, magic, lights) and sparingly.
- The model faces +Z here; the exporter turns it to face Roblox's front (-Z LookVector) automatically.`;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
export const PRESETS = {
  roblox_smooth: {
    label: 'Roblox — Smooth (modern)',
    modelStyle: 'smooth',
    defaultMaterial: 'smooth',
    image: `Style: a modern Roblox Studio build made only from Roblox parts — rectangular blocks, wedges, cylinders and spheres — in SmoothPlastic with clean flat colors from the Roblox BrickColor palette, no studs, no textures, no bevel modelling, no organic sculpting.
Chunky readable game-asset proportions, crisp straight edges, a few accent parts in Neon only where something glows.
Rendered like a Roblox Studio screenshot with soft daylight and gentle shadows on a plain neutral light-grey background, the whole model centered with margin, no scene, no text.`,
    rules: `## Style: Roblox Smooth (modern)
- Default material SmoothPlastic ("smooth"); Metal/Wood/Fabric etc. only where the reference clearly shows them.
- Free sizes and positions on a 0.05-stud grid; rotations in 5° or 15° steps when possible.
- Shape rounded forms with cylinders, spheres and wedges (wedges to chamfer corners); layer a few overlapping parts for detail instead of tiny slivers.
- Flat colors, 4–8 colors per model, mostly from the BrickColor palette.`,
  },
  roblox_studs: {
    label: 'Roblox — Studs (classic)',
    modelStyle: 'studs',
    defaultMaterial: 'plastic',
    image: `Style: a classic 2008-era Roblox brick build, like LEGO: every part is a plastic brick with round studs on its top surface (and inlets underneath), built only from rectangular bricks, plates, wedges and the occasional cylinder, sized on a 1-stud grid.
Classic BrickColor palette (Bright red, Bright blue, Bright yellow, Bright green, Medium stone grey, Dark stone grey, Reddish brown, Brick yellow, White, Black), plastic material with a slight sheen, thin dark outlines on part edges.
Blocky, toy-like proportions, no smooth curves, no textures besides studs, no text.
Rendered like an old Roblox Studio screenshot with bright even lighting on a plain neutral light-grey background, the whole model centered with margin.`,
    rules: `## Style: Roblox Studs (classic) — follow strictly
- Material: Plastic for everything (Neon only for glowing eyes/lights). Top surfaces get studs and bottoms inlets automatically.
- Sizes: X and Z in WHOLE studs (1, 2, 3, 4…). Height Y in classic FormFactor steps: plate 0.4, symmetric 1.0, brick 1.2 (multiples allowed: 0.8, 2.4, 3.6…).
- Positions on the stud grid: X/Z edges land on whole studs (odd width → center on .5, even width → center on a whole number); stack heights in 0.4 increments.
- Rotations only in 90° steps (use wedges for slopes, never tilted bricks).
- Colors: only classic BrickColors (the core list above).
- No sub-stud details, no offsets of .25/.75; simplify small features into bricks and plates. Think LEGO.
- Call roblox_snap (mode "studs") before finishing to enforce the grid, sizes and colors.`,
  },
  roblox_lowpoly: {
    label: 'Roblox — Stylized low-poly (trending)',
    modelStyle: 'smooth',
    defaultMaterial: 'smooth',
    image: `Style: a trending stylized low-poly Roblox game asset, built from blocks, wedges, cylinders and spheres in SmoothPlastic, with vibrant saturated colors (bright primaries, neon accents and pastels) like popular anime-inspired Roblox games.
Exaggerated cartoon proportions: big head and features, chunky body, short stubby limbs, bold readable silhouette, corners cut with wedges for a faceted low-poly look, two-tone color blocking (lighter top, darker underside), no textures, no gradients, no realism.
Rendered with bright soft lighting on a plain neutral light-grey background, entire model centered with margin, no scene, no text.`,
    rules: `## Style: Roblox Stylized low-poly (2026 trend)
- Low-poly is the most common Roblox style; the rising look is bright, stylized and "anime game" vibrant.
- Exaggerate proportions: bigger head/eyes, chunkier torso, shorter limbs; strong silhouette that reads from far away.
- Facets: chamfer edges with wedges and use few, bold shapes; avoid tiny details.
- Color blocking: saturated main colors + one or two accent colors; lighter tone on top surfaces/forward parts, darker tone below. Neon accents for magic/eyes.
- Foliage/hair/manes: clustered spheres or stacked wedges ("cartoon foliage"), not thin strands.
- SmoothPlastic everywhere unless the reference demands another material.`,
  },
  custom: {
    label: 'Custom (style/ folder)',
    modelStyle: 'smooth',
    defaultMaterial: 'plastic',
    image: null, // uses style/style-prompt.md or the built-in default
    rules: '',
  },
};
export const DEFAULT_PRESET = 'roblox_smooth';
export const presetOf = (id) => PRESETS[id] || PRESETS[DEFAULT_PRESET];

// ---------------------------------------------------------------------------
// roblox_snap: enforce grid / sizes / colors on the whole model.
// mode "studs": classic FormFactor rules; mode "smooth": 0.05 grid + palette colors.
// ---------------------------------------------------------------------------
const roundTo = (v, step) => Math.round(Math.round(v / step) * step * 1000) / 1000;

export function snapModel(model, { mode = 'smooth', colors = true } = {}) {
  let changed = 0;
  const palette = mode === 'studs' ? CLASSIC_BRICKCOLORS : BRICKCOLORS;
  for (const p of model.parts) {
    const before = JSON.stringify(p);
    if (p.type === 'group') {
      p.pivot = p.pivot.map((v) => roundTo(v, mode === 'studs' ? 0.1 : 0.05));
      if (mode === 'studs') p.rotation = p.rotation.map((r) => roundTo(r, 90));
    } else {
      if (mode === 'studs') {
        const [sx, sy, sz] = p.size;
        const W = Math.max(1, Math.round(sx)), D = Math.max(1, Math.round(sz));
        // nearest classic height: multiples of 0.4 (plate) or exactly 1.0 (symmetric)
        const plate = Math.max(0.4, roundTo(sy, 0.4));
        const H = Math.abs(sy - 1) < Math.abs(sy - plate) ? 1 : plate;
        p.size = [W, H, D];
        const gx = (v, n) => (n % 2 ? Math.floor(v) + 0.5 : Math.round(v));
        const bottom = Math.max(0, roundTo(p.position[1] - sy / 2, 0.4));
        p.position = [gx(p.position[0], W), roundTo(bottom + H / 2, 0.001), gx(p.position[2], D)];
        p.rotation = p.rotation.map((r) => roundTo(r, 90));
        if (!['neon'].includes(p.material)) p.material = 'plastic';
      } else {
        p.size = p.size.map((v) => Math.max(0.1, roundTo(v, 0.05)));
        p.position = p.position.map((v) => roundTo(v, 0.05));
      }
      if (p.shape === 'cylinder') { const d = (p.size[0] + p.size[2]) / 2; p.size[0] = p.size[2] = roundTo(d, 0.05); }
      if (colors) p.color = nearestBrickColor(p.color, palette).hex;
    }
    if (JSON.stringify(p) !== before) changed++;
  }
  return changed;
}

export function paletteText(limit = 0) {
  const list = Object.entries(BRICKCOLORS);
  return (limit ? list.slice(0, limit) : list).map(([n, h]) => `${n} ${h}`).join(', ');
}
