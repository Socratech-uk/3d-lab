/** Static-mesh editing. Every public operation returns a separate geometry.
 * Reduction is constrained quadric-error edge collapse (not a remesher).
 * UV/material seams and open/nonmanifold borders are retained. The requested
 * ratio is consequently best effort; callers must show the returned counts.
 */
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';

const components = ['getX', 'getY', 'getZ', 'getW'];
const value = (a, i, c) => a[components[c]](i);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pointArray = p => Array.isArray(p) || ArrayBuffer.isView(p) ? [Number(p[0]), Number(p[1]), Number(p[2])] : [Number(p?.x), Number(p?.y), Number(p?.z)];
function validate(g) {
  if (!g?.isBufferGeometry || !g.attributes.position || g.attributes.position.itemSize !== 3) throw new Error('A triangle BufferGeometry with XYZ positions is required.');
  if (Object.values(g.morphAttributes ?? {}).some(a => a.length) || g.attributes.skinIndex || g.attributes.skinWeight) throw new Error('Bake skinning or morph targets to a static mesh before editing.');
  for (const [name, a] of Object.entries(g.attributes)) if (a.count !== g.attributes.position.count || a.itemSize < 1 || a.itemSize > 4) throw new Error(`Unsupported or incomplete ${name} vertex attribute.`);
}
function extent(g) {
  const a = g.attributes.position, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < 3; c++) { const v = value(a, i, c); if (Number.isFinite(v)) { min[c] = Math.min(min[c], v); max[c] = Math.max(max[c], v); } }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!Number.isFinite(size) || size <= 0) throw new Error('The component has no finite, nonzero dimensions.');
  return {min, max, size};
}
const edgeKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
const positionKey = (p, i, epsilon) => `${Math.round(p[i * 3] / epsilon)},${Math.round(p[i * 3 + 1] / epsilon)},${Math.round(p[i * 3 + 2] / epsilon)}`;
function normalOf(p, a, b, c, replacement, replaceA = -1, replaceB = -1) {
  const ax = a === replaceA || a === replaceB ? replacement[0] : p[a * 3], ay = a === replaceA || a === replaceB ? replacement[1] : p[a * 3 + 1], az = a === replaceA || a === replaceB ? replacement[2] : p[a * 3 + 2];
  const ux = (b === replaceA || b === replaceB ? replacement[0] : p[b * 3]) - ax, uy = (b === replaceA || b === replaceB ? replacement[1] : p[b * 3 + 1]) - ay, uz = (b === replaceA || b === replaceB ? replacement[2] : p[b * 3 + 2]) - az;
  const vx = (c === replaceA || c === replaceB ? replacement[0] : p[c * 3]) - ax, vy = (c === replaceA || c === replaceB ? replacement[1] : p[c * 3 + 1]) - ay, vz = (c === replaceA || c === replaceB ? replacement[2] : p[c * 3 + 2]) - az;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
const norm2 = n => n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
function finish(g, source, stats) {
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  g.name = source.name; g.userData = {...source.userData, builderOperation: stats}; return g;
}
function packed(positions, attributes, faces, source, stats) {
  const result = new THREE.BufferGeometry(), remap = new Map(), streams = new Map(Object.entries(attributes).map(([n, a]) => [n, {size: a.size, array: []}])), out = [], indices = [];
  let previousMaterial = -1, groupStart = 0;
  for (const f of faces) {
    if (previousMaterial !== f.material) { if (previousMaterial >= 0) result.addGroup(groupStart, indices.length - groupStart, previousMaterial); previousMaterial = f.material; groupStart = indices.length; }
    for (const old of [f.a, f.b, f.c]) {
      let v = remap.get(old);
      if (v === undefined) { v = remap.size; remap.set(old, v); out.push(positions[old * 3], positions[old * 3 + 1], positions[old * 3 + 2]); for (const [name, data] of streams) for (let c = 0; c < data.size; c++) data.array.push(attributes[name].array[old * data.size + c]); }
      indices.push(v);
    }
  }
  if (previousMaterial >= 0) result.addGroup(groupStart, indices.length - groupStart, previousMaterial);
  result.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  for (const [name, data] of streams) result.setAttribute(name, new THREE.Float32BufferAttribute(data.array, data.size));
  result.setIndex(indices); return finish(result, source, stats);
}

/** Weld compatible vertices, remove invalid/duplicate/zero-area faces, rebuild normals.
 * Different UVs, colours, normals or materials are deliberately not welded.
 */
export function cleanupGeometry(geometry) {
  validate(geometry); const {size} = extent(geometry), epsilon = size * 1e-8, minArea2 = size ** 4 * 1e-24;
  const position = geometry.attributes.position, count = geometry.index?.count ?? position.count, triangles = Math.floor(count / 3), materials = new Int32Array(triangles);
  for (const group of geometry.groups) { const start = Math.max(0, Math.ceil(group.start / 3)), end = Math.min(triangles, Math.floor((group.start + group.count) / 3)); for (let i = start; i < end; i++) materials[i] = Number.isInteger(group.materialIndex) && group.materialIndex >= 0 ? group.materialIndex : 0; }
  const names = Object.keys(geometry.attributes).filter(n => n !== 'position' && n !== 'normal' && n !== 'tangent'), attrs = Object.fromEntries(names.map(n => [n, {size: geometry.attributes[n].itemSize, array: []}]));
  const positions = [], faces = [], vertices = new Map(), vertexCache = new Map(), duplicateFaces = new Set(); let dropped = 0;
  const getVertex = (i, material) => {
    if (!Number.isInteger(i) || i < 0 || i >= position.count) return -1;
    const cacheKey = `${i}/${material}`; if (vertexCache.has(cacheKey)) return vertexCache.get(cacheKey);
    const p = [position.getX(i), position.getY(i), position.getZ(i)]; if (!p.every(Number.isFinite)) { vertexCache.set(cacheKey, -1); return -1; }
    const streams = names.map(n => Array.from({length: geometry.attributes[n].itemSize}, (_, c) => value(geometry.attributes[n], i, c)));
    if (streams.some(a => !a.every(Number.isFinite))) { vertexCache.set(cacheKey, -1); return -1; }
    const normal = geometry.attributes.normal; const normalKey = normal ? [normal.getX(i), normal.getY(i), normal.getZ(i)].map(v => Number.isFinite(v) ? Math.round(v * 1e5) : 0).join(',') : '';
    const key = `${material}|${p.map(v => Math.round(v / epsilon)).join(',')}|${normalKey}|${streams.map(a => a.join(',')).join('|')}`;
    let v = vertices.get(key); if (v === undefined) { v = positions.length / 3; vertices.set(key, v); positions.push(...p); names.forEach((n, j) => attrs[n].array.push(...streams[j])); }
    vertexCache.set(cacheKey, v); return v;
  };
  const start = Math.max(0, Math.ceil((geometry.drawRange?.start ?? 0) / 3)), end = Math.min(triangles, Math.floor(((geometry.drawRange?.start ?? 0) + (geometry.drawRange?.count ?? Infinity)) / 3));
  for (let i = start; i < end; i++) {
    const m = materials[i], a = getVertex(geometry.index ? geometry.index.getX(i * 3) : i * 3, m), b = getVertex(geometry.index ? geometry.index.getX(i * 3 + 1) : i * 3 + 1, m), c = getVertex(geometry.index ? geometry.index.getX(i * 3 + 2) : i * 3 + 2, m);
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c || norm2(normalOf(positions, a, b, c)) <= minArea2) { dropped++; continue; }
    const key = `${m}/${[a, b, c].sort((a, b) => a - b).join(',')}`; if (duplicateFaces.has(key)) { dropped++; continue; } duplicateFaces.add(key); faces.push({a, b, c, material: m});
  }
  if (!faces.length) throw new Error('No valid triangles remain after removing invalid or degenerate faces.');
  return packed(positions, attrs, faces, geometry, {operation: 'cleanup', before: triangles, after: faces.length, removedFaces: dropped, weldedVertices: Math.max(0, position.count - new Set(faces.flatMap(f => [f.a, f.b, f.c])).size)});
}

/** Centre the component and make its longest dimension targetSize imported units. */
export function normalizeGeometry(geometry, targetSize = 2) {
  targetSize = Number(targetSize); if (!Number.isFinite(targetSize) || targetSize <= 0 || targetSize > 1e9) throw new Error('Target size must be a positive finite value no greater than 1,000,000,000.');
  const out = cleanupGeometry(geometry), {min, max, size} = extent(out), a = out.attributes.position, scale = targetSize / size;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, (a.getX(i) - (min[0] + max[0]) / 2) * scale, (a.getY(i) - (min[1] + max[1]) / 2) * scale, (a.getZ(i) - (min[2] + max[2]) / 2) * scale);
  return finish(out, geometry, {operation: 'normalize', targetSize, scale});
}

class MinHeap {
  constructor() { this.items = []; }
  push(v) { const a = this.items; let i = a.length; a.push(v); while (i) { const p = (i - 1) >> 1; if (a[p].cost <= v.cost) break; a[i] = a[p]; i = p; } a[i] = v; }
  pop() { const a = this.items; if (!a.length) return null; const first = a[0], v = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let child = i * 2 + 1; if (child + 1 < a.length && a[child + 1].cost < a[child].cost) child++; if (a[child].cost >= v.cost) break; a[i] = a[child]; i = child; } a[i] = v; } return first; }
}
const quadCost = (q, p) => Math.max(0, q[0] * p[0] ** 2 + 2 * q[1] * p[0] * p[1] + 2 * q[2] * p[0] * p[2] + 2 * q[3] * p[0] + q[4] * p[1] ** 2 + 2 * q[5] * p[1] * p[2] + 2 * q[6] * p[1] + q[7] * p[2] ** 2 + 2 * q[8] * p[2] + q[9]);
function optimalPoint(q) {
  const a = q[0], b = q[1], c = q[2], d = q[4], e = q[5], f = q[7];
  const A = d * f - e * e, B = c * e - b * f, C = b * e - c * d, D = a * f - c * c, E = b * c - a * e, F = a * d - b * b, det = a * A + b * B + c * C;
  const norm = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), Math.abs(e), Math.abs(f)); if (Math.abs(det) < Math.max(1e-40, norm ** 3 * 1e-10)) return null;
  return [-(A * q[3] + B * q[6] + C * q[8]) / det, -(B * q[3] + D * q[6] + E * q[8]) / det, -(C * q[3] + E * q[6] + F * q[8]) / det];
}

/** ratio = fraction of triangles to retain, 0.02..1. Existing seams stay intact.
 * Options: preserveSharpEdges (default true), sharpAngle (degrees, default 60).
 */
export function simplifyGeometry(geometry, ratio = .5, options = {}) {
  ratio = Number(ratio); if (!Number.isFinite(ratio) || ratio < .02 || ratio > 1) throw new Error('Keep ratio must be between 0.02 and 1.');
  const clean = cleanupGeometry(geometry), before = (geometry.index?.count ?? geometry.attributes.position.count) / 3, initial = clean.index.count / 3, target = Math.max(4, Math.ceil(initial * ratio));
  if (initial <= target) return {geometry: clean, before, after: initial, ratio: initial / before, method: 'Constrained quadric-error edge collapse', warnings: []};
  const p = Float64Array.from(clean.attributes.position.array), n = p.length / 3, q = new Float64Array(n * 10), alive = new Uint8Array(n).fill(1), locked = new Uint8Array(n), versions = new Uint32Array(n), adjacent = Array.from({length: n}, () => new Set()), faces = [], edgeMap = new Map();
  const attrs = Object.fromEntries(Object.entries(clean.attributes).filter(([name]) => name !== 'position' && name !== 'normal' && name !== 'tangent').map(([name, a]) => [name, {size: a.itemSize, array: Float64Array.from(a.array)}]));
  const {size} = extent(clean), minArea2 = size ** 4 * 1e-24, material = new Int32Array(initial); for (const g of clean.groups) for (let i = g.start / 3; i < (g.start + g.count) / 3; i++) material[i] = g.materialIndex;
  const samePosition = new Map(); for (let i = 0; i < n; i++) { const key = positionKey(p, i, size * 1e-8), previous = samePosition.get(key); if (previous === undefined) samePosition.set(key, i); else { locked[i] = 1; locked[previous] = 1; } }
  for (let i = 0; i < initial; i++) {
    const a = clean.index.getX(i * 3), b = clean.index.getX(i * 3 + 1), c = clean.index.getX(i * 3 + 2), normal = normalOf(p, a, b, c), area = Math.sqrt(norm2(normal)); normal[0] /= area; normal[1] /= area; normal[2] /= area;
    const d = -(normal[0] * p[a * 3] + normal[1] * p[a * 3 + 1] + normal[2] * p[a * 3 + 2]), plane = [normal[0], normal[1], normal[2], d], quad = [];
    for (let x = 0; x < 4; x++) for (let y = x; y < 4; y++) quad.push(plane[x] * plane[y] * area);
    faces.push({a, b, c, material: material[i], alive: true}); for (const v of [a, b, c]) { adjacent[v].add(i); for (let k = 0; k < 10; k++) q[v * 10 + k] += quad[k]; }
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { const key = edgeKey(x, y), old = edgeMap.get(key); if (old) { old.count++; old.minimumDot = Math.min(old.minimumDot, old.normal[0] * normal[0] + old.normal[1] * normal[1] + old.normal[2] * normal[2]); } else edgeMap.set(key, {a: x, b: y, count: 1, normal, minimumDot: 1}); }
  }
  const sharpAngle = Number(options.sharpAngle ?? 60);
  if (!Number.isFinite(sharpAngle) || sharpAngle < 1 || sharpAngle > 179) { clean.dispose(); throw new Error('Sharp-edge angle must be from 1 to 179 degrees.'); }
  const sharpCos = Math.cos(sharpAngle * Math.PI / 180);
  for (const edge of edgeMap.values()) if (edge.count !== 2 || (options.preserveSharpEdges !== false && edge.minimumDot < sharpCos)) { locked[edge.a] = 1; locked[edge.b] = 1; }
  const heap = new MinHeap();
  const candidate = (a, b) => {
    if (!alive[a] || !alive[b] || locked[a] && locked[b]) return;
    if (locked[b] || (!locked[a] && a > b)) [a, b] = [b, a];
    const sum = new Float64Array(10); for (let i = 0; i < 10; i++) sum[i] = q[a * 10 + i] + q[b * 10 + i];
    const pa = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], pb = [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], mid = pa.map((v, i) => (v + pb[i]) / 2), length2 = pa.reduce((s, v, i) => s + (v - pb[i]) ** 2, 0);
    let point = pa, cost = quadCost(sum, pa);
    if (!locked[a]) { const choices = [pb, mid], optimum = optimalPoint(sum); if (optimum?.every(Number.isFinite) && optimum.reduce((s, v, i) => s + (v - mid[i]) ** 2, 0) <= length2 * 2.25) choices.push(optimum); for (const option of choices) { const next = quadCost(sum, option); if (next < cost || next === cost && option === mid) { point = option; cost = next; } } }
    // A tiny edge-length tie-breaker avoids consuming all planar edges in ID order.
    heap.push({a, b, point, cost: cost + length2 * size * size * 1e-14, va: versions[a], vb: versions[b]});
  };
  for (const e of edgeMap.values()) candidate(e.a, e.b); edgeMap.clear();
  const neighbours = a => { const set = new Set(); for (const t of adjacent[a]) { const f = faces[t]; for (const v of [f.a, f.b, f.c]) if (v !== a) set.add(v); } return set; };
  let remaining = initial, collapses = 0, rejected = 0;
  while (remaining > target && heap.items.length) {
    const entry = heap.pop(), {a, b, point} = entry;
    if (!alive[a] || !alive[b] || versions[a] !== entry.va || versions[b] !== entry.vb) continue;
    if (adjacent[a].size > 256 || adjacent[b].size > 256) { rejected++; continue; }
    const na = neighbours(a), nb = neighbours(b); if (!na.has(b)) continue;
    let shared = 0, edgeFaces = 0; for (const v of na) if (nb.has(v)) shared++; for (const t of adjacent[a]) if (adjacent[b].has(t)) edgeFaces++;
    // The link condition rejects pinches, disconnected fans and duplicate faces.
    if (edgeFaces !== 2 || shared !== 2 || remaining - edgeFaces < target) { rejected++; continue; }
    const touched = new Set([...adjacent[a], ...adjacent[b]]); let valid = true;
    for (const t of touched) {
      const f = faces[t]; if ([f.a, f.b, f.c].includes(a) && [f.a, f.b, f.c].includes(b)) continue;
      const old = normalOf(p, f.a, f.b, f.c), next = normalOf(p, f.a, f.b, f.c, point, a, b), oldArea = norm2(old), nextArea = norm2(next), dot = old[0] * next[0] + old[1] * next[1] + old[2] * next[2];
      if (nextArea <= minArea2 || dot <= Math.sqrt(oldArea * nextArea) * .2) { valid = false; break; }
    }
    if (!valid) { rejected++; continue; }
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2], bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2], len2 = (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
    const blend = locked[a] || !len2 ? 0 : clamp(((point[0] - ax) * (bx - ax) + (point[1] - ay) * (by - ay) + (point[2] - az) * (bz - az)) / len2, 0, 1);
    for (const attr of Object.values(attrs)) for (let i = 0; i < attr.size; i++) attr.array[a * attr.size + i] = attr.array[a * attr.size + i] * (1 - blend) + attr.array[b * attr.size + i] * blend;
    p[a * 3] = point[0]; p[a * 3 + 1] = point[1]; p[a * 3 + 2] = point[2]; for (let i = 0; i < 10; i++) q[a * 10 + i] += q[b * 10 + i];
    alive[b] = 0; versions[a]++; versions[b]++;
    for (const t of touched) {
      const f = faces[t], hasA = f.a === a || f.b === a || f.c === a, hasB = f.a === b || f.b === b || f.c === b;
      if (hasA && hasB) { f.alive = false; remaining--; for (const v of [f.a, f.b, f.c]) adjacent[v].delete(t); }
      else if (hasB) { adjacent[b].delete(t); if (f.a === b) f.a = a; if (f.b === b) f.b = a; if (f.c === b) f.c = a; adjacent[a].add(t); }
    }
    collapses++; for (const v of neighbours(a)) candidate(a, v);
  }
  const warnings = remaining > target + 1 ? ['Seams, borders or face-fold protection prevented the full requested reduction.'] : [];
  const result = packed(p, attrs, faces.filter(f => f.alive), geometry, {operation: 'simplify', method: 'Constrained quadric-error edge collapse', before, after: remaining, target, collapses, rejected, warnings}); clean.dispose();
  return {geometry: result, before, after: remaining, ratio: remaining / before, target, collapses, method: 'Constrained quadric-error edge collapse', warnings};
}

/** One brush dab in geometry-local coordinates; strength is 0..1.
 * The brush follows the nearest connected, front-facing surface inside its radius.
 * It never reaches a disconnected nearby back wall. UV seam duplicates move together.
 */
export function sculptGeometry(geometry, {point, normal, radius, strength = .25, mode = 'smooth'} = {}) {
  validate(geometry); const centre = pointArray(point), direction = pointArray(normal ?? [0, 0, 1]); radius = Number(radius); strength = Number(strength);
  if (!centre.every(Number.isFinite) || !direction.every(Number.isFinite) || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('Brush point, normal and radius must be finite; strength must be from 0 to 1.');
  if (!['smooth', 'inflate', 'deflate', 'flatten'].includes(mode)) throw new Error('Choose Smooth, Inflate, Deflate or Flatten.');
  const dlength = Math.hypot(...direction); if (dlength < 1e-10) throw new Error('A nonzero brush surface normal is required.'); for (let i = 0; i < 3; i++) direction[i] /= dlength;
  const out = cleanupGeometry(geometry), position = out.attributes.position, original = Float64Array.from(position.array), normals = out.attributes.normal, epsilon = extent(out).size * 1e-8, nodes = [], map = new Map(), vertexNode = new Uint32Array(position.count);
  for (let i = 0; i < position.count; i++) { const key = positionKey(original, i, epsilon); let n = map.get(key); if (n === undefined) { n = nodes.length; map.set(key, n); nodes.push({point: [position.getX(i), position.getY(i), position.getZ(i)], normal: [0, 0, 0], vertices: [], neighbours: new Set()}); } vertexNode[i] = n; nodes[n].vertices.push(i); for (let c = 0; c < 3; c++) nodes[n].normal[c] += value(normals, i, c); }
  for (let i = 0; i < out.index.count; i += 3) { const a = vertexNode[out.index.getX(i)], b = vertexNode[out.index.getX(i + 1)], c = vertexNode[out.index.getX(i + 2)]; for (const [x, y] of [[a, b], [b, c], [c, a]]) if (x !== y) { nodes[x].neighbours.add(y); nodes[y].neighbours.add(x); } }
  let seed = -1, distance = Infinity; const eligible = new Uint8Array(nodes.length), distances = new Float64Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) { const node = nodes[i], len = Math.hypot(...node.normal); if (len) for (let c = 0; c < 3; c++) node.normal[c] /= len; const d2 = node.point.reduce((s, v, c) => s + (v - centre[c]) ** 2, 0); distances[i] = Math.sqrt(d2); const facing = node.normal.reduce((s, v, c) => s + v * direction[c], 0); if (d2 < radius ** 2 && facing > .05) { eligible[i] = 1; if (d2 < distance) { distance = d2; seed = i; } } }
  let changed = 0;
  if (seed >= 0 && strength > 0) {
    const queue = [seed], visited = new Uint8Array(nodes.length); visited[seed] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], node = nodes[i], falloff = (1 - (distances[i] / radius) ** 2) ** 2, amount = strength * falloff, target = [...node.point];
      if (mode === 'smooth') { const avg = [0, 0, 0]; for (const n of node.neighbours) for (let c = 0; c < 3; c++) avg[c] += nodes[n].point[c]; if (node.neighbours.size) for (let c = 0; c < 3; c++) target[c] += (avg[c] / node.neighbours.size - node.point[c]) * amount * .5; }
      else if (mode === 'flatten') { const signed = node.point.reduce((s, v, c) => s + (v - centre[c]) * direction[c], 0); for (let c = 0; c < 3; c++) target[c] -= direction[c] * signed * amount; }
      else { const sign = mode === 'deflate' ? -1 : 1; for (let c = 0; c < 3; c++) target[c] += node.normal[c] * radius * amount * .2 * sign; }
      for (const vertex of node.vertices) position.setXYZ(vertex, ...target); changed += node.vertices.length;
      for (const neighbour of node.neighbours) if (eligible[neighbour] && !visited[neighbour]) { visited[neighbour] = 1; queue.push(neighbour); }
    }
  }
  // If a strong dab would fold a triangle, reduce the entire dab until it is valid.
  let damping = 1; const wanted = Float64Array.from(position.array), threshold = extent(out).size ** 4 * 1e-24;
  for (let attempt = 0; attempt < 9; attempt++) {
    let valid = true; const current = position.array;
    for (let i = 0; i < out.index.count; i += 3) { const a = out.index.getX(i), b = out.index.getX(i + 1), c = out.index.getX(i + 2), prev = normalOf(original, a, b, c), next = normalOf(current, a, b, c); if (norm2(next) <= threshold || prev[0] * next[0] + prev[1] * next[1] + prev[2] * next[2] <= 0) { valid = false; break; } }
    if (valid) break;
    damping = attempt === 8 ? 0 : damping * .5; for (let i = 0; i < current.length; i++) current[i] = original[i] + (wanted[i] - original[i]) * damping;
  }
  return finish(out, geometry, {operation: 'sculpt', mode, radius, strength, affectedVertices: damping ? changed : 0, damping});
}
