/** Pure, resource-owning static component operations.
 * Inputs are never changed, including their cached matrices/bounds. Outputs use
 * the input's parent coordinate system; ancestor transforms are deliberately not
 * included. Bake before reparenting into another coordinate system.
 */
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';

const GET = ['getX', 'getY', 'getZ', 'getW'];
const requireValue = (value, message) => { if (!value) throw new Error(message); };
const vector = (value, fallback, label) => {
  const v = value == null ? fallback : value?.isVector3 ? value.toArray() : Array.from(value);
  requireValue(v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9), `${label} requires three finite numbers.`);
  return v;
};
const meshList = object => { const nodes = []; object.traverse(node => { if (node.isMesh) nodes.push(node); }); return nodes; };
function validateMesh(mesh, limit) {
  const geometry = mesh.geometry, position = geometry?.attributes?.position;
  requireValue(!mesh.isSkinnedMesh && !mesh.isInstancedMesh && !Object.values(geometry?.morphAttributes ?? {}).some(a => a.length) && !geometry?.attributes?.skinIndex && !geometry?.attributes?.skinWeight, 'Bake skinning, instances and morph targets before editing components.');
  requireValue(position?.itemSize === 3, 'A component needs triangle geometry with XYZ positions.');
  const count = geometry.index?.count ?? position.count;
  requireValue(count % 3 === 0 && count > 0, 'Use a component with complete triangles.');
  if (limit !== undefined) requireValue(count / 3 <= limit, `Use a component with up to ${limit.toLocaleString('en-US')} triangles for this operation.`);
  for (const [name, attribute] of Object.entries(geometry.attributes)) requireValue(attribute.count === position.count && attribute.itemSize >= 1 && attribute.itemSize <= 4, `Unsupported or incomplete ${name} vertex attribute.`);
  for (let i = 0; i < position.count; i++) requireValue(Number.isFinite(position.getX(i)) && Number.isFinite(position.getY(i)) && Number.isFinite(position.getZ(i)), 'The component contains a non-finite position.');
  if (geometry.index) for (let i = 0; i < count; i++) { const n = geometry.index.getX(i); requireValue(Number.isInteger(n) && n >= 0 && n < position.count, 'The component contains an invalid triangle index.'); }
}

/** Clone geometry, materials and texture handles. Raster pixels are immutable;
 * typed pixel arrays are copied, while browser ImageBitmaps/canvases stay shared.
 * Never close shared ImageBitmaps when disposing an output.
 */
function materialCloner() {
  const materials = new Map(), textures = new Map();
  const copyTexture = texture => {
    if (textures.has(texture)) return textures.get(texture);
    const copy = texture.clone(), image = texture.image;
    copy.source = new THREE.Source(image?.data && ArrayBuffer.isView(image.data) ? {...image, data: image.data.slice()} : image);
    copy.needsUpdate = true; textures.set(texture, copy); return copy;
  };
  const copyMaterial = material => {
    if (materials.has(material)) return materials.get(material);
    const copy = material.clone(); materials.set(material, copy);
    for (const [key, value] of Object.entries(material)) if (value?.isTexture) copy[key] = copyTexture(value);
    return copy;
  };
  return copyMaterial;
}
export function cloneComponent(input, {recursive = true} = {}) {
  requireValue(input?.isObject3D, 'Select a component first.');
  const result = input.clone(recursive), geometries = new Map(), copyMaterial = materialCloner();
  result.traverse(node => {
    if (node.geometry) { if (!geometries.has(node.geometry)) geometries.set(node.geometry, node.geometry.clone()); node.geometry = geometries.get(node.geometry); }
    if (node.material) node.material = Array.isArray(node.material) ? node.material.map(copyMaterial) : copyMaterial(node.material);
  });
  return result;
}

export function disposeComponent(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object?.traverse(node => { if (node.geometry) geometries.add(node.geometry); for (const material of [node.material].flat().filter(Boolean)) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); } });
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
}

// A reflected position transform reverses winding; keep the normals and tangent
// handedness consistent rather than relying on DoubleSide to conceal the error.
function transformGeometry(geometry, matrix) {
  const output = geometry.clone(); output.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    if (!output.index) { const a = new Uint32Array(output.attributes.position.count); for (let i = 0; i < a.length; i++) a[i] = i; output.setIndex(new THREE.BufferAttribute(a, 1)); }
    for (let i = 0; i < output.index.count; i += 3) { const n = output.index.getX(i + 1); output.index.setX(i + 1, output.index.getX(i + 2)); output.index.setX(i + 2, n); }
    if (output.attributes.tangent?.itemSize === 4) { const t = output.attributes.tangent; for (let i = 0; i < t.count; i++) t.setW(i, -t.getW(i)); }
  }
  output.computeBoundingBox(); output.computeBoundingSphere(); return output;
}

/** Bake delta translation, degree XYZ rotation and scale about the component's
 * bounds centre. Optional pivot is in the same parent coordinates. Child meshes,
 * including projected-image overlays, receive exactly the same transformation.
 */
export function transformComponent(input, options = {}) {
  const position = vector(options.position, [0, 0, 0], 'Position'), rotation = vector(options.rotation, [0, 0, 0], 'Rotation'), scale = vector(options.scale, [1, 1, 1], 'Scale');
  requireValue(scale.every(v => Math.abs(v) >= 1e-6 && Math.abs(v) <= 100000), 'Scale must be nonzero, with magnitude from 0.000001 to 100,000.');
  const result = cloneComponent(input);
  try {
    result.updateMatrixWorld(true); const nodes = meshList(result), bounds = new THREE.Box3();
    requireValue(nodes.length > 0, 'Select a component containing a mesh.');
    for (const node of nodes) { validateMesh(node); requireValue(Math.abs(node.matrixWorld.determinant()) > 1e-18, 'The component has a zero scale.'); const box = new THREE.Box3().setFromBufferAttribute(node.geometry.attributes.position); bounds.union(box.applyMatrix4(node.matrixWorld)); }
    const pivot = vector(options.pivot, bounds.getCenter(new THREE.Vector3()).toArray(), 'Pivot');
    const operation = new THREE.Matrix4().makeTranslation(position[0] + pivot[0], position[1] + pivot[1], position[2] + pivot[2]);
    operation.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation.map(v => v * Math.PI / 180), 'XYZ'))).multiply(new THREE.Matrix4().makeScale(...scale)).multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
    const oldGeometries = new Set();
    for (const node of nodes) { oldGeometries.add(node.geometry); node.geometry = transformGeometry(node.geometry, new THREE.Matrix4().multiplyMatrices(operation, node.matrixWorld)); }
    for (const g of oldGeometries) g.dispose();
    result.traverse(node => { node.position.set(0, 0, 0); node.quaternion.identity(); node.scale.set(1, 1, 1); node.matrix.identity(); node.matrixWorld.identity(); node.matrixAutoUpdate = true; });
    result.updateMatrixWorld(true); return result;
  } catch (error) { disposeComponent(result); throw error; }
}

export function duplicateComponent(input, {offset = [0, 0, 0], name} = {}) {
  const output = transformComponent(input, {position: offset}); output.name = name || `${input.name || 'Part'} copy`; return output;
}
export function mirrorComponent(input, axis = 'x') {
  requireValue(['x', 'y', 'z'].includes(axis), 'Mirror axis must be X, Y or Z.'); const scale = [1, 1, 1]; scale['xyz'.indexOf(axis)] = -1;
  const output = transformComponent(input, {scale}); output.userData.builderMirror = axis; return output;
}

/** Panel/plane is a thin solid, suitable for interior floors and partitions. */
export function createPrimitive(type = 'box', {size, position, segments = 24, name, color = 0xaab7c8} = {}) {
  requireValue(['box', 'sphere', 'cylinder', 'plane', 'panel'].includes(type), 'Choose Box, Sphere, Cylinder or Panel.');
  const dimensions = vector(size, type === 'plane' || type === 'panel' ? [1, .02, 1] : [1, 1, 1], 'Size'), centre = vector(position, [0, 0, 0], 'Position');
  requireValue(dimensions.every(n => n > 0 && n <= 100000), 'Primitive dimensions must be positive and no greater than 100,000.');
  requireValue(Number.isInteger(segments) && segments >= 3 && segments <= 64, 'Primitive segments must be an integer from 3 to 64.');
  let geometry;
  if (type === 'sphere') geometry = new THREE.SphereGeometry(.5, Math.max(8, segments), Math.max(4, Math.floor(segments / 2))).scale(...dimensions);
  else if (type === 'cylinder') geometry = new THREE.CylinderGeometry(.5, .5, 1, segments, 1).scale(...dimensions);
  else geometry = new THREE.BoxGeometry(...dimensions);
  geometry.translate(...centre); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const output = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color, roughness: .8})); output.name = name || (type === 'plane' ? 'Panel' : type[0].toUpperCase() + type.slice(1)); output.userData.builderPrimitive = type; return output;
}

function faceMaterials(geometry, material) {
  const count = geometry.index?.count ?? geometry.attributes.position.count, ids = new Int32Array(count / 3);
  if (Array.isArray(material)) {
    ids.fill(-1);
    for (const group of geometry.groups) { requireValue(Number.isInteger(group.materialIndex) && material[group.materialIndex], 'A component references a missing material.'); for (let i = Math.max(0, Math.ceil(group.start / 3)); i < Math.min(ids.length, Math.floor((group.start + group.count) / 3)); i++) ids[i] = group.materialIndex; }
    if (!geometry.groups.length) ids.fill(0);
  }
  return ids;
}
function range(geometry) { const count = geometry.index?.count ?? geometry.attributes.position.count; return [Math.max(0, Math.ceil((geometry.drawRange?.start || 0) / 3)), Math.min(count / 3, Math.floor(((geometry.drawRange?.start || 0) + (geometry.drawRange?.count ?? Infinity)) / 3))]; }
function addGroup(geometry, start, count, materialIndex) { const last = geometry.groups.at(-1); if (last && last.materialIndex === materialIndex && last.start + last.count === start) last.count += count; else geometry.addGroup(start, count, materialIndex); }

/** Merge selected roots and their mesh children. UVs/colours/normals survive,
 * material assignments become groups, and no source geometry is welded away.
 */
export function mergeComponents(inputs, {name = 'Merged parts'} = {}) {
  requireValue(Array.isArray(inputs) && inputs.length >= 2, 'Select at least two components to merge.');
  requireValue(new Set(inputs).size === inputs.length, 'A component cannot be merged with itself.');
  for (const input of inputs) { requireValue(input?.isObject3D, 'Select mesh components to merge.'); for (let p = input.parent; p; p = p.parent) requireValue(!inputs.includes(p), 'Select a parent or its children, not both.'); }
  const copies = [];
  try {
    for (const input of inputs) { const copy = transformComponent(input); copies.push(copy); copy.traverse(node => { requireValue(node.visible, 'Show hidden components and children before merging.'); }); }
    const meshes = copies.flatMap(meshList);
    const attributes = new Map(); let vertexCount = 0;
    for (const mesh of meshes) { const geometry = mesh.geometry; if (!geometry.attributes.normal) geometry.computeVertexNormals(); vertexCount += geometry.attributes.position.count; for (const [key, attr] of Object.entries(geometry.attributes)) { requireValue(!attributes.has(key) || attributes.get(key) === attr.itemSize, `Selected ${key} attributes have incompatible sizes.`); attributes.set(key, attr.itemSize); } }
    const geometry = new THREE.BufferGeometry(), streams = new Map([...attributes].map(([key, size]) => [key, new Float32Array(vertexCount * size)])), materials = [], indices = [];
    let vertexOffset = 0;
    for (const mesh of meshes) {
      const source = mesh.geometry, count = source.attributes.position.count, sourceMaterials = [mesh.material].flat(), materialOffset = materials.length;
      materials.push(...sourceMaterials); // These resources belong to copies; ownership moves to output below.
      for (const [key, size] of attributes) { const attr = source.attributes[key], out = streams.get(key); for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) out[(vertexOffset + i) * size + c] = attr ? attr[GET[c]](i) : key === 'color' || key === 'tangent' && (c === 0 || c === 3) ? 1 : 0; }
      const ids = faceMaterials(source, mesh.material), [start, end] = range(source);
      for (let i = start; i < end; i++) if (ids[i] >= 0) { addGroup(geometry, indices.length, 3, materialOffset + ids[i]); for (let c = 0; c < 3; c++) indices.push(vertexOffset + (source.index ? source.index.getX(i * 3 + c) : i * 3 + c)); }
      vertexOffset += count;
    }
    requireValue(indices.length, 'No visible triangles remain in the selected components.');
    for (const [key, size] of attributes) geometry.setAttribute(key, new THREE.Float32BufferAttribute(streams.get(key), size));
    geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const output = new THREE.Mesh(geometry, materials); output.name = name; output.userData = {builderOperation: 'merge', builderSources: inputs.map(input => input.name || 'Part')};
    // Dispose only geometry: material and texture ownership has transferred.
    const oldGeometries = new Set(); for (const copy of copies) copy.traverse(n => { if (n.geometry) oldGeometries.add(n.geometry); }); for (const g of oldGeometries) g.dispose();
    return output;
  } catch (error) { for (const copy of copies) disposeComponent(copy); throw error; }
}

function subsetGeometry(source, faces) {
  const output = new THREE.BufferGeometry(), oldToNew = new Map(), indices = [], attrs = Object.entries(source.attributes), data = new Map(attrs.map(([name]) => [name, []]));
  for (const face of faces) {
    addGroup(output, indices.length, 3, face.material);
    for (const old of face.vertices) {
      if (!oldToNew.has(old)) { oldToNew.set(old, oldToNew.size); for (const [name, attr] of attrs) for (let c = 0; c < attr.itemSize; c++) data.get(name).push(attr[GET[c]](old)); }
      indices.push(oldToNew.get(old));
    }
  }
  for (const [name, attr] of attrs) output.setAttribute(name, new THREE.Float32BufferAttribute(data.get(name), attr.itemSize));
  output.setIndex(indices); output.name = source.name; output.userData = JSON.parse(JSON.stringify(source.userData)); output.computeBoundingBox(); output.computeBoundingSphere(); return output;
}

/** Edge-connected surface islands, joining coincident positions across UV seams.
 * Children are retained as separate baked components after the primary islands.
 * This avoids silently attaching a texture spanning islands to one arbitrary part.
 */
export function splitDisconnectedComponents(input, {name, epsilon, maxIslands = 256} = {}) {
  requireValue(input?.isMesh, 'Select a mesh component to separate its islands.'); validateMesh(input, 350000);
  requireValue(Number.isInteger(maxIslands) && maxIslands >= 1 && maxIslands <= 512, 'Island limit must be from 1 to 512.');
  const copy = transformComponent(input), output = [];
  try {
    const geometry = copy.geometry, position = geometry.attributes.position, size = geometry.boundingBox.getSize(new THREE.Vector3()).length();
    epsilon = epsilon ?? Math.max(size * 1e-8, 1e-12); requireValue(Number.isFinite(epsilon) && epsilon > 0 && epsilon <= Math.max(size * .001, 1e-12), 'Island tolerance must be positive and smaller than 0.1% of the component size.');
    const welded = new Map(), vertexIds = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) { const key = `${Math.round(position.getX(i) / epsilon)},${Math.round(position.getY(i) / epsilon)},${Math.round(position.getZ(i) / epsilon)}`; if (!welded.has(key)) welded.set(key, welded.size); vertexIds[i] = welded.get(key); }
    const faces = [], ids = faceMaterials(geometry, copy.material), [start, end] = range(geometry);
    for (let i = start; i < end; i++) if (ids[i] >= 0) faces.push({vertices: [0, 1, 2].map(c => geometry.index ? geometry.index.getX(i * 3 + c) : i * 3 + c), material: ids[i]});
    requireValue(faces.length, 'The component has no visible triangles to separate.');
    const parent = new Int32Array(faces.length); for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const edges = new Map();
    faces.forEach((face, index) => { const vertices = face.vertices.map(v => vertexIds[v]); for (let k = 0; k < 3; k++) { const a = vertices[k], b = vertices[(k + 1) % 3]; if (a === b) continue; const key = a < b ? `${a}/${b}` : `${b}/${a}`; if (edges.has(key)) parent[find(index)] = find(edges.get(key)); else edges.set(key, index); } });
    const islands = new Map(); faces.forEach((face, index) => { const root = find(index); if (!islands.has(root)) islands.set(root, []); islands.get(root).push(face); });
    requireValue(islands.size <= maxIslands, `This mesh has ${islands.size} islands. Clean or reduce it first (limit ${maxIslands}).`);
    let i = 0;
    for (const island of islands.values()) {
      // Clone only this island's geometry, not the entire input per island.
      const mesh = copy.clone(false), copyMaterial = materialCloner();
      mesh.geometry = subsetGeometry(geometry, island); mesh.material = Array.isArray(copy.material) ? copy.material.map(copyMaterial) : copyMaterial(copy.material);
      mesh.name = `${name || input.name || 'Part'} ${++i}`; mesh.userData.builderIsland = i; output.push(mesh);
    }
    for (const child of copy.children) output.push(cloneComponent(child));
    disposeComponent(copy); return output;
  } catch (error) { disposeComponent(copy); for (const object of output) disposeComponent(object); throw error; }
}
