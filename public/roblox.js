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
  return `<Item class="${cls}" referent="${ref()}"><Properties>` +
    `<bool name="Anchored">true</bool><bool name="CanCollide">true</bool>` +
    cframe(pos, rot) + color3(p.color) +
    `<token name="Material">${MATERIAL_TOKEN[p.material] ?? 256}</token>` +
    `<string name="Name">${esc(p.name)}</string>` +
    `<float name="Transparency">${transparency}</float>` +
    vec3('size', size) +
    (cls === 'Part' ? `<token name="shape">${shape}</token>` : '') +
    `<token name="TopSurface">${top}</token><token name="BottomSurface">${bottom}</token>` +
    ['Front', 'Back', 'Left', 'Right'].map((f) => `<token name="${f}Surface">${studs && style === 'studs_all' ? SURF.studs : SURF.smooth}</token>`).join('') +
    `</Properties>${mesh}</Item>`;
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
