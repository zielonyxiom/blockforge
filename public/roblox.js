// Roblox Studio export (.rbxmx XML model). Drag the file into Studio to get real,
// anchored Parts / WedgeParts grouped into Models, facing Roblox's front (-Z).
import * as THREE from 'three';

// Enum.Material values
const MATERIAL_TOKEN = {
  plastic: 256, smooth: 272, neon: 288, wood: 512, woodplanks: 528, marble: 784, slate: 800,
  concrete: 816, granite: 832, brick: 848, cobblestone: 880, corrodedmetal: 1040, diamondplate: 1056,
  foil: 1072, metal: 1088, grass: 1280, sand: 1296, fabric: 1312, ice: 1536, glass: 1568, forcefield: 1584,
};
const SURF = { smooth: 0, studs: 3, inlet: 4 };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const n = (v) => (Math.abs(v) < 1e-7 ? 0 : +v.toFixed(5));

let refSeq = 0;
const ref = () => 'RBX' + (++refSeq).toString(16).toUpperCase().padStart(8, '0');

function cframe(pos, m) {
  const e = m.elements; // column-major
  return `<CoordinateFrame name="CFrame"><X>${n(pos.x)}</X><Y>${n(pos.y)}</Y><Z>${n(pos.z)}</Z>` +
    `<R00>${n(e[0])}</R00><R01>${n(e[4])}</R01><R02>${n(e[8])}</R02>` +
    `<R10>${n(e[1])}</R10><R11>${n(e[5])}</R11><R12>${n(e[9])}</R12>` +
    `<R20>${n(e[2])}</R20><R21>${n(e[6])}</R21><R22>${n(e[10])}</R22></CoordinateFrame>`;
}
const vec3 = (name, v) => `<Vector3 name="${name}"><X>${n(v[0])}</X><Y>${n(v[1])}</Y><Z>${n(v[2])}</Z></Vector3>`;
function color3(hex) {
  const v = parseInt(hex.slice(1), 16);
  return `<Color3uint8 name="Color3uint8">${(0xff000000 | v) >>> 0}</Color3uint8>`;
}

// Model faces +Z in the editor; Roblox's front is -Z → rotate everything 180° around Y.
const TO_ROBLOX = new THREE.Matrix4().makeRotationY(Math.PI);
const LOCAL_FIX = {
  cylinder: new THREE.Matrix4().makeRotationZ(Math.PI / 2), // Roblox cylinder axis is X
  wedge: new THREE.Matrix4().makeRotationY(Math.PI),        // Roblox wedge is tall at +Z
};

function partXml(p, obj, style) {
  const world = new THREE.Matrix4().multiplyMatrices(TO_ROBLOX, obj.matrixWorld);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  world.decompose(pos, quat, scl);
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(quat);
  let size = [scl.x, scl.y, scl.z];
  let cls = 'Part', shape = 1, mesh = '';
  if (p.shape === 'cylinder') { rot.multiply(LOCAL_FIX.cylinder); size = [scl.y, scl.x, scl.z]; shape = 2; }
  else if (p.shape === 'wedge') { rot.multiply(LOCAL_FIX.wedge); cls = 'WedgePart'; }
  else if (p.shape === 'sphere') {
    const uniform = Math.max(...size) - Math.min(...size) < 0.01;
    if (uniform) shape = 0;
    else mesh = `<Item class="SpecialMesh" referent="${ref()}"><Properties><token name="MeshType">3</token>${vec3('Scale', [1, 1, 1])}<string name="Name">Mesh</string></Properties></Item>`;
  }
  // Studs/inlets only on plain blocks (cylinders, balls and wedge slopes look wrong with them).
  const studs = String(style).startsWith('studs') && cls === 'Part' && shape === 1 && !mesh && !['neon', 'glass', 'forcefield', 'ice'].includes(p.material);
  const top = studs ? SURF.studs : SURF.smooth, bottom = studs ? SURF.inlet : SURF.smooth;
  const transparency = p.material === 'glass' ? 0.5 : 0;
  // House style: SmoothPlastic + a "2022" MaterialVariant + 4 shading decals on the side faces.
  const special = ['neon', 'glass', 'forcefield'].includes(p.material);
  const house = style === 'house' && !special;
  const material = house ? 'smooth' : p.material;
  const variant = house ? (p.variant || defaultVariant(p)) : p.variant;
  const decals = house && p.gradientDecals !== false ? GRADIENT_FACES.map(decalXml).join('') : '';
  return `<Item class="${cls}" referent="${ref()}"><Properties>` +
    `<bool name="Anchored">true</bool><bool name="CanCollide">true</bool>` +
    cframe(pos, rot) + color3(p.color) +
    `<token name="Material">${MATERIAL_TOKEN[material] ?? 256}</token>` +
    (variant ? `<string name="MaterialVariantSerialized">${esc(variant)}</string>` : '') +
    `<string name="Name">${esc(p.name)}</string>` +
    `<float name="Transparency">${transparency}</float>` +
    vec3('size', size) +
    (cls === 'Part' ? `<token name="shape">${shape}</token>` : '') +
    `<token name="TopSurface">${top}</token><token name="BottomSurface">${bottom}</token>` +
    ['Front', 'Back', 'Left', 'Right'].map((f) => `<token name="${f}Surface">${studs && style === 'studs_all' ? SURF.studs : SURF.smooth}</token>`).join('') +
    `</Properties>${mesh}${decals}</Item>`;
}

// House-style shading decal: a vertical alpha gradient (dark toward the bottom) on each side face.
// Enum.NormalId: Right 0, Top 1, Back 2, Left 3, Bottom 4, Front 5.
const GRADIENT_TEXTURE = 'rbxassetid://127473043565552';
const GRADIENT_FACES = [5, 2, 3, 0];
const decalXml = (face) => `<Item class="Decal" referent="${ref()}"><Properties>` +
  `<string name="Name">Decal</string><token name="Face">${face}</token>` +
  `<Content name="Texture"><url>${GRADIENT_TEXTURE}</url></Content>` +
  `<Color3 name="Color3"><R>0</R><G>0</G><B>0</B></Color3>` +
  `<float name="Transparency">0.85</float><int name="ZIndex">1</int>` +
  `</Properties></Item>`;

// Wood (trunks, branches, roots) gets the stud variant, everything else the small universal one.
function defaultVariant(p) {
  if (p.shape === 'sphere') return '2022 Weld';
  if (/trunk|branch|root|twig|wood|stem|log|bark|base/i.test(p.name || '')) return '2022 Small Stud';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.color.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const hue = max === min ? 0 : max === r ? (60 * ((g - b) / (max - min)) + 360) % 360 : max === g ? 60 * ((b - r) / (max - min)) + 120 : 60 * ((r - g) / (max - min)) + 240;
  const brown = hue >= 10 && hue <= 45 && max < 0.6 && (max - min) / max > 0.25;
  return brown ? '2022 Small Stud' : '2022 Small Universal';
}

// Luau script that builds the model directly in Roblox Studio (run it with the Studio MCP
// execute_luau tool or the command bar). Same parts, CFrames, colors, MaterialVariants and
// decals as the .rbxmx export; it replaces an earlier model with the same name and stands
// the model on the ground found under `target`.
export function exportLuau(model, buildModelObject, { name, target = [0, 0, 0] } = {}) {
  const { root, objects } = buildModelObject(model, { edges: false });
  root.updateMatrixWorld(true);
  const rows = [];
  const f = (v) => +n(v).toFixed(3);
  for (const p of model.parts) {
    if (p.type === 'group' || p.visible === false) continue;
    const obj = objects.get(p.id);
    const world = new THREE.Matrix4().multiplyMatrices(TO_ROBLOX, obj.matrixWorld);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    world.decompose(pos, quat, scl);
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(quat);
    let size = [scl.x, scl.y, scl.z], cls = 'Part', shape = 1, ball = 0;
    if (p.shape === 'cylinder') { rot.multiply(LOCAL_FIX.cylinder); size = [scl.y, scl.x, scl.z]; shape = 2; }
    else if (p.shape === 'wedge') { rot.multiply(LOCAL_FIX.wedge); cls = 'WedgePart'; }
    else if (p.shape === 'sphere') { if (Math.max(...size) - Math.min(...size) < 0.01) shape = 0; else ball = 1; }
    const e = rot.elements;
    const special = ['neon', 'glass', 'forcefield'].includes(p.material);
    const house = model.style === 'house' && !special;
    const material = house ? 'smooth' : p.material;
    const variant = house ? (p.variant || defaultVariant(p)) : (p.variant || '');
    const decals = house && p.gradientDecals !== false ? 1 : 0;
    rows.push(`{${JSON.stringify(cls)},${JSON.stringify(p.name)},{${[pos.x, pos.y, pos.z, e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].map(f).join(',')}},{${size.map(f).join(',')}},${parseInt(p.color.slice(1), 16)},${JSON.stringify(material)},${JSON.stringify(variant)},${shape},${ball},${decals},${p.material === 'glass' ? 0.5 : 0}}`);
  }
  const title = name || model.name || 'BlockForgeModel';
  return `-- ${title}: built by BlockForge (${rows.length} parts)
local NAME, TARGET = ${JSON.stringify(title)}, Vector3.new(${target.map(f).join(', ')})
local D = {
${rows.join(',\n')}
}
local MAT = { smooth = Enum.Material.SmoothPlastic, plastic = Enum.Material.Plastic, neon = Enum.Material.Neon, glass = Enum.Material.Glass, wood = Enum.Material.Wood, woodplanks = Enum.Material.WoodPlanks, metal = Enum.Material.Metal, slate = Enum.Material.Slate, concrete = Enum.Material.Concrete, brick = Enum.Material.Brick, granite = Enum.Material.Granite, marble = Enum.Material.Marble, cobblestone = Enum.Material.Cobblestone, fabric = Enum.Material.Fabric, grass = Enum.Material.Grass, sand = Enum.Material.Sand, ice = Enum.Material.Ice, foil = Enum.Material.Foil, diamondplate = Enum.Material.DiamondPlate, corrodedmetal = Enum.Material.CorrodedMetal, forcefield = Enum.Material.ForceField }
local hit = workspace:Raycast(TARGET + Vector3.new(0, 80, 0), Vector3.new(0, -300, 0))
local groundY = hit and hit.Position.Y or TARGET.Y
local old = workspace:FindFirstChild(NAME)
if old then old:Destroy() end
local model = Instance.new("Model")
model.Name = NAME
for _, d in ipairs(D) do
\tlocal p = Instance.new(d[1])
\tp.Name, p.Anchored = d[2], true
\tlocal c = d[3]
\tp.Size = Vector3.new(d[4][1], d[4][2], d[4][3])
\tp.CFrame = CFrame.new(c[1] + TARGET.X, c[2] + groundY, c[3] + TARGET.Z, c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12])
\tp.Color = Color3.fromRGB(bit32.rshift(d[5], 16) % 256, bit32.rshift(d[5], 8) % 256, d[5] % 256)
\tp.Material = MAT[d[6]] or Enum.Material.SmoothPlastic
\tif d[7] ~= "" then p.MaterialVariant = d[7] end
\tp.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
\tp.Transparency = d[11]
\tif d[1] == "Part" and d[8] == 0 then p.Shape = Enum.PartType.Ball elseif d[1] == "Part" and d[8] == 2 then p.Shape = Enum.PartType.Cylinder end
\tif d[9] == 1 then local m = Instance.new("SpecialMesh"); m.MeshType = Enum.MeshType.Sphere; m.Parent = p end
\tif d[10] == 1 then
\t\tfor _, face in ipairs({ Enum.NormalId.Front, Enum.NormalId.Back, Enum.NormalId.Left, Enum.NormalId.Right }) do
\t\t\tlocal dc = Instance.new("Decal")
\t\t\tdc.Face, dc.Texture, dc.Color3, dc.Transparency, dc.ZIndex = face, "${GRADIENT_TEXTURE}", Color3.new(0, 0, 0), 0.85, 1
\t\t\tdc.Parent = p
\t\tend
\tend
\tp.Parent = model
end
model.Parent = workspace
local cf, s = model:GetBoundingBox()
return string.format("%s: %d parts at %s, size %s", NAME, #model:GetChildren(), tostring(cf.Position), tostring(s))
`;
}

// buildModelObject: the editor's builder (returns { root, objects }).
export function exportRbxmx(model, buildModelObject) {
  refSeq = 0;
  const { root, objects } = buildModelObject(model, { edges: false });
  root.updateMatrixWorld(true);
  let count = 0;
  const walk = (parentId) => model.parts.filter((p) => p.parent === parentId && p.visible !== false).map((p) => {
    if (p.type === 'group') {
      return `<Item class="Model" referent="${ref()}"><Properties><string name="Name">${esc(p.name)}</string></Properties>${walk(p.id).join('')}</Item>`;
    }
    count++;
    return partXml(p, objects.get(p.id), model.style);
  });
  const body = walk(null).join('');
  const xml = `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">` +
    `<External>null</External><External>nil</External>` +
    `<Item class="Model" referent="${ref()}"><Properties><string name="Name">${esc(model.name || 'BlockForgeModel')}</string></Properties>${body}</Item>` +
    `</roblox>`;
  return { xml, parts: count };
}
