import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {createPrimitive, cloneComponent, disposeComponent, duplicateComponent, transformComponent, mirrorComponent, mergeComponents, splitDisconnectedComponents} from '../src/builder-objects.mjs';
import {surfaceTopology} from '../src/builder-solids.mjs';

let count = 0;
const test = (name, fn) => { fn(); count++; console.log('PASS', name); };
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const bounds = object => { object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(object); };
const snapshot = object => JSON.stringify(object.toJSON());
const triangleCount = object => { let n = 0; object.traverse(m => { if (m.isMesh) n += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; }); return n; };
function assertFacing(geometry) {
  const p = geometry.attributes.position, normal = geometry.attributes.normal, count = geometry.index?.count ?? p.count;
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(c => geometry.index ? geometry.index.getX(i + c) : i + c), points = ids.map(v => new THREE.Vector3().fromBufferAttribute(p, v));
    const face = points[1].sub(points[0]).cross(points[2].sub(points[0]));
    if (face.lengthSq() < 1e-16) continue;
    const n = new THREE.Vector3().fromBufferAttribute(normal, ids[0]); assert.ok(face.dot(n) > 0, 'Stored normal faces the visible side of each triangle.');
  }
}

test('primitives use exact dimensions, finite bounds, normals and bounded detail', () => {
  for (const type of ['box', 'sphere', 'cylinder', 'panel', 'plane']) {
    const object = createPrimitive(type, {size: [2, 4, 6], position: [5, 6, 7], segments: 24});
    const b = bounds(object), s = b.getSize(new THREE.Vector3()); s.toArray().forEach((v, i) => close(v, [2, 4, 6][i]));
    assert.deepEqual(b.getCenter(new THREE.Vector3()).toArray(), [5, 6, 7]); assert.ok(triangleCount(object) < 1000); assertFacing(object.geometry); disposeComponent(object);
  }
  const panel = createPrimitive('panel'); close(bounds(panel).getSize(new THREE.Vector3()).y, .02); disposeComponent(panel);
  assert.throws(() => createPrimitive('box', {size: [0, 1, 1]}), /positive/);
  assert.throws(() => createPrimitive('sphere', {segments: 100000}), /3 to 64/);
  assert.throws(() => createPrimitive('box', {position: [NaN, 0, 0]}), /finite/);
});

test('duplicate owns geometry, materials, textures and typed pixels without changing the source', () => {
  const source = createPrimitive('box', {name: 'Door'}), texture = new THREE.DataTexture(new Uint8Array([4, 5, 6, 255]), 1, 1); source.material.map = texture;
  const before = snapshot(source), duplicate = duplicateComponent(source, {offset: [3, 0, 0]});
  assert.equal(duplicate.name, 'Door copy'); close(bounds(duplicate).min.x, 2.5);
  assert.notEqual(duplicate.geometry, source.geometry); assert.notEqual(duplicate.material, source.material); assert.notEqual(duplicate.material.map, texture); assert.notEqual(duplicate.material.map.source, texture.source);
  duplicate.material.map.image.data[0] = 99; assert.equal(texture.image.data[0], 4);
  let disposedSource = 0; for (const owned of [source.geometry, source.material, texture]) owned.addEventListener('dispose', () => disposedSource++);
  disposeComponent(duplicate); assert.equal(disposedSource, 0); assert.equal(snapshot(source), before);
});

test('transforms bake nested children and overlays around bounds without mutating matrices', () => {
  const root = new THREE.Group(); root.position.set(3, 2, -1); root.rotation.y = .4;
  const hull = createPrimitive('box', {size: [2, 1, 1]}); hull.position.x = 2; root.add(hull);
  const overlay = createPrimitive('panel', {size: [.3, .04, .3]}); overlay.position.y = .7; overlay.userData.cappReferenceProjection = true; hull.add(overlay);
  const original = snapshot(root), reference = cloneComponent(root), originalBounds = bounds(reference), pivot = originalBounds.getCenter(new THREE.Vector3()), transform = new THREE.Matrix4().makeTranslation(pivot.x + 2, pivot.y + 3, pivot.z + 4).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(2, 1, .5)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  reference.updateMatrixWorld(true); const expected = new THREE.Vector3().fromBufferAttribute(reference.children[0].children[0].geometry.attributes.position, 0).applyMatrix4(reference.children[0].children[0].matrixWorld).applyMatrix4(transform);
  const result = transformComponent(root, {position: [2, 3, 4], rotation: [0, 0, 90], scale: [2, 1, .5]});
  const actual = new THREE.Vector3().fromBufferAttribute(result.children[0].children[0].geometry.attributes.position, 0); close(actual.distanceTo(expected), 0);
  result.traverse(n => { assert.deepEqual(n.position.toArray(), [0, 0, 0]); assert.deepEqual(n.scale.toArray(), [1, 1, 1]); });
  assert.equal(result.children[0].children[0].userData.cappReferenceProjection, true); assert.equal(snapshot(root), original); disposeComponent(result); disposeComponent(reference);
});

test('mirroring indexed and non-indexed meshes keeps outward faces and tangent handedness', () => {
  for (const indexed of [true, false]) for (const axis of ['x', 'y', 'z']) {
    const source = createPrimitive('box', {size: [2, 3, 4], position: [7, 8, 9]}); if (!indexed) source.geometry = source.geometry.toNonIndexed();
    const n = source.geometry.attributes.position.count, tangent = new Float32Array(n * 4); for (let i = 0; i < n; i++) { tangent[i * 4] = 1; tangent[i * 4 + 3] = 1; } source.geometry.setAttribute('tangent', new THREE.Float32BufferAttribute(tangent, 4));
    const result = mirrorComponent(source, axis); assertFacing(result.geometry); close(surfaceTopology(result.geometry).signedVolume, 24);
    assert.deepEqual(bounds(result).getCenter(new THREE.Vector3()).toArray(), [7, 8, 9]); for (let i = 0; i < n; i++) assert.equal(result.geometry.attributes.tangent.getW(i), -1);
    assert.deepEqual(Array.from(result.geometry.attributes.uv.array), Array.from(source.geometry.attributes.uv.array)); disposeComponent(result);
  }
});

test('baking a pre-existing negative transform corrects winding only once', () => {
  const source = createPrimitive('box'); source.scale.set(-2, 3, 4); source.position.set(2, 3, 4);
  const before = snapshot(source), result = transformComponent(source); assertFacing(result.geometry); close(surfaceTopology(result.geometry).signedVolume, 24);
  const twice = mirrorComponent(result); assertFacing(twice.geometry); close(surfaceTopology(twice.geometry).signedVolume, 24); assert.equal(snapshot(source), before);
});

test('merge preserves source transforms, UVs, normals, material groups and projection children', () => {
  const red = createPrimitive('box', {name: 'Red', color: 0xff0000}); red.position.set(-3, 0, 0);
  const green = createPrimitive('box', {name: 'Green', color: 0x00ff00}); green.position.set(3, 0, 0); green.rotation.z = Math.PI / 2; green.scale.x = -1;
  const overlay = createPrimitive('panel', {size: [.3, .02, .3], color: 0x0000ff}); overlay.position.y = .6; overlay.userData.cappReferenceProjection = true; green.add(overlay);
  const sourceSnapshots = [snapshot(red), snapshot(green)], merged = mergeComponents([red, green]);
  assert.equal(triangleCount(merged), 36); assert.equal(merged.material.length, 3); assert.equal(merged.geometry.groups.length, 3);
  assert.deepEqual(merged.material.map(m => m.color.getHex()), [0xff0000, 0x00ff00, 0x0000ff]); assertFacing(merged.geometry);
  assert.equal(merged.geometry.attributes.uv.count, merged.geometry.attributes.position.count); close(bounds(merged).min.x, -3.5); close(bounds(merged).max.x, 3.5);
  assert.equal(snapshot(red), sourceSnapshots[0]); assert.equal(snapshot(green), sourceSnapshots[1]);
});

test('merge retains multi-material face groups and fills absent colour streams with white', () => {
  const a = createPrimitive('box'), b = createPrimitive('box', {position: [3, 0, 0]});
  a.material = Array.from({length: 6}, (_, i) => new THREE.MeshStandardMaterial({color: new THREE.Color().setRGB(i / 6, 0, 0)}));
  a.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(a.geometry.attributes.position.count * 3).fill(.5), 3));
  const out = mergeComponents([a, b]); assert.equal(out.material.length, 7); assert.equal(out.geometry.groups.length, 7);
  const color = out.geometry.attributes.color; close(color.getX(0), .5); close(color.getX(color.count - 1), 1);
});

test('island separation joins UV seam duplicates, preserves appearance and reconstructs all triangles', () => {
  const a = createPrimitive('box', {position: [-2, 0, 0], color: 0xff0000}), b = createPrimitive('box', {position: [2, 0, 0], color: 0x00ff00}), merged = mergeComponents([a, b]), before = snapshot(merged), islands = splitDisconnectedComponents(merged);
  assert.equal(islands.length, 2); assert.equal(islands.reduce((n, m) => n + triangleCount(m), 0), 24);
  for (const mesh of islands) { assert.equal(triangleCount(mesh), 12); assert.equal(surfaceTopology(mesh.geometry).boundaryEdges, 0); assertFacing(mesh.geometry); assert.ok(mesh.geometry.attributes.uv); }
  assert.equal(islands[0].geometry.groups[0].materialIndex, 0); assert.equal(islands[1].geometry.groups[0].materialIndex, 1); assert.equal(snapshot(merged), before);
  assert.notEqual(islands[0].material[0], islands[1].material[0]); assert.notEqual(islands[0].material[0], merged.material[0]);
});

test('islands touching only at a single corner remain separate', () => {
  const a = createPrimitive('box'), b = createPrimitive('box', {position: [1, 1, 1]}); const islands = splitDisconnectedComponents(mergeComponents([a, b])); assert.equal(islands.length, 2);
});

test('separation retains child overlays once, independently owned and in their baked position', () => {
  const parent = mergeComponents([createPrimitive('box', {position: [-2, 0, 0]}), createPrimitive('box', {position: [2, 0, 0]})]); parent.position.y = 3;
  const child = createPrimitive('panel', {position: [0, .6, 0]}); child.userData.cappReferenceProjection = true; parent.add(child);
  const before = snapshot(parent), parts = splitDisconnectedComponents(parent); assert.equal(parts.length, 3); assert.equal(parts.filter(p => p.userData.cappReferenceProjection).length, 1);
  close(bounds(parts[2]).getCenter(new THREE.Vector3()).y, 3.6); assert.equal(snapshot(parent), before); assert.notEqual(parts[2].material, child.material);
});

test('invalid scales, animated sources, hidden merge geometry and excessive islands fail safely', () => {
  const a = createPrimitive('box'), b = createPrimitive('box', {position: [3, 0, 0]}), before = snapshot(a);
  assert.throws(() => transformComponent(a, {scale: [0, 1, 1]}), /nonzero/); assert.throws(() => transformComponent(a, {rotation: [Infinity, 0, 0]}), /finite/);
  b.visible = false; assert.throws(() => mergeComponents([a, b]), /hidden/); b.visible = true;
  assert.throws(() => mergeComponents([a, a]), /itself/); assert.throws(() => splitDisconnectedComponents(mergeComponents([a, b]), {maxIslands: 1}), /2 islands/);
  a.geometry.setAttribute('skinIndex', new THREE.Float32BufferAttribute(new Float32Array(a.geometry.attributes.position.count * 4), 4)); assert.throws(() => transformComponent(a), /skinning/); a.geometry.deleteAttribute('skinIndex'); assert.equal(snapshot(a), before);
});

console.log(`${count} component operation checks passed.`);
