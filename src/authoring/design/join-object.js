/** Join evaluated static visual surfaces in a new, independently owned prop.
 * Authored source parts remain in a durable snapshot for an explicit restore.
 * This module does not write files, change defaults or infer gameplay physics.
 */
import * as THREE from 'three';
import { createSolNode, deepClone, solId, validateSolModelDocument } from '../src/model-format/sol-model-document.js';
import { extractSolComponent, isSolComponentDocument } from '../src/model-format/sol-component-library.js?v=1.1.0';
import { createSolThreeNodeObject, disposeSolThreeObject } from '../src/model-format/sol-three-model.js?v=1.3.0';

export const SOL_JOINED_OBJECT_FORMAT = 'sol-joined-object';
export const SOL_JOINED_OBJECT_VERSION = 1;
const MAX_VERTICES = 65535;
const EPSILON = 1e-5;
const MOTION_COMPONENTS = new Set(['hinge', 'slider', 'mover', 'thruster']);
const HELPER_TAGS = new Set(['helper', 'collision-helper', 'collider-helper', 'source-hidden']);
const swizzle = point => [-point[2], point[0], point[1]];

export function isJoinedObjectDocument(document) {
  const joined = document?.meta?.parameters?.joinedObject;
  return Boolean(isSolComponentDocument(document) && joined?.format === SOL_JOINED_OBJECT_FORMAT
    && joined.version === SOL_JOINED_OBJECT_VERSION
    && document.nodes.some(node => node.id === joined.meshId && node.type === 'mesh'));
}

/** Named source-part ranges remain valid only while ordered topology matches.
 * Materials, UVs, vertex positions and normals may change independently.
 */
export function joinedObjectPartRangesValid(document) {
  if (!isJoinedObjectDocument(document)) return false;
  const joined = document.meta.parameters.joinedObject;
  const geometry = document.nodes.find(node => node.id === joined.meshId).geometry;
  const topology = joined.partTopology;
  if (!Array.isArray(topology) || !Array.isArray(geometry?.faces) || !Array.isArray(geometry?.vertices)
    || topology.length !== geometry.faces.length || topology.length !== joined.triangleCount
    || geometry.vertices.length > MAX_VERTICES || topology.length * 3 > MAX_VERTICES) return false;
  const vertexCount = geometry.vertices.length;
  if (!topology.every((indices, index) => Array.isArray(indices) && indices.length === 3
    && Array.isArray(geometry.faces[index]?.vertices) && geometry.faces[index].vertices.length === 3
    && indices.every((vertex, corner) => Number.isInteger(vertex) && vertex >= 0 && vertex < vertexCount
      && geometry.faces[index].vertices[corner] === vertex))) return false;
  if (!Array.isArray(joined.parts) || !joined.parts.length || joined.parts.length !== joined.partCount) return false;
  let nextFace = 0;
  for (const part of joined.parts) {
    if (!part || !Number.isInteger(part.firstFace) || part.firstFace !== nextFace
      || !Number.isInteger(part.faceCount) || part.faceCount < 1 || part.faceCount > topology.length - nextFace) return false;
    nextFace += part.faceCount;
  }
  return nextFace === topology.length;
}

function hierarchy(document) {
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const matrices = new Map();
  const matrixFor = id => {
    if (matrices.has(id)) return matrices.get(id);
    const node = nodes.get(id);
    if (!node) throw new TypeError('Joined object has a missing parent.');
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...node.transform.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...node.transform.rotation)),
      new THREE.Vector3(...node.transform.scale),
    );
    const matrix = node.parentId ? matrixFor(node.parentId).clone().multiply(local) : local;
    matrices.set(id, matrix);
    return matrix;
  };
  return { nodes, matrixFor };
}

function identityLinear(matrix) {
  return [0, 1, 2, 4, 5, 6, 8, 9, 10].every(index =>
    Math.abs(matrix.elements[index] - ([0, 5, 10].includes(index) ? 1 : 0)) <= EPSILON);
}

function exclusionReasons(document, nodes) {
  const animated = new Set(document.animations.flatMap(clip => (clip.tracks || []).map(track => track.nodeId)));
  const referenced = new Set();
  for (const collider of document.physics?.colliders || []) if (collider.nodeId) referenced.add(collider.nodeId);
  for (const clip of document.animations || []) for (const event of clip.events || []) if (event.nodeId) referenced.add(event.nodeId);
  for (const node of document.nodes) for (const behavior of node.components || []) {
    if (behavior.targetNodeId) referenced.add(behavior.targetNodeId);
    if (behavior.targetSocketNodeId) referenced.add(behavior.targetSocketNodeId);
    for (const id of behavior.targetNodeIds || []) referenced.add(id);
  }
  const reasonFor = node => {
    let ancestor = node;
    while (ancestor) {
      if (ancestor.visible === false) return 'Hidden source surface';
      if ((ancestor.tags || []).some(tag => HELPER_TAGS.has(tag))) return 'Editor or collision helper';
      if (animated.has(ancestor.id)) return 'Animated object or animated ancestor';
      if ((ancestor.tags || []).some(tag => /^(source-animation:|humanoid-bind:)/.test(tag))) return 'Captured moving part';
      if ((ancestor.tags || []).some(tag => /^source-screen:/.test(tag))) return 'Live display surface';
      if (ancestor.joint?.kind && ancestor.joint.kind !== 'fixed') return 'Articulated joint';
      if ((ancestor.components || []).some(item => item.enabled !== false && MOTION_COMPONENTS.has(item.type))) return 'Moving behavior or moving ancestor';
      ancestor = nodes.get(ancestor.parentId);
    }
    if (node.sockets?.length || node.components?.length) return 'Socket or behavior owner';
    if (referenced.has(node.id)) return 'Referenced interaction, animation event or collider object';
    return '';
  };
  return reasonFor;
}

function evaluatedPiece(node, matrix, materials, projection, textureScale) {
  if (node.type === 'mesh' && node.geometry?.vertices?.length > MAX_VERTICES) throw new RangeError('Source mesh exceeds the 65,535-vertex SOL limit. Join a smaller assembly.');
  const dummy = new THREE.MeshBasicMaterial();
  const materialMap = new Map([...materials.keys()].map(id => [id, dummy]));
  const object = createSolThreeNodeObject(node, dummy, materialMap);
  object.matrixAutoUpdate = false;
  object.matrix.copy(matrix);
  object.updateMatrixWorld(true);
  const triangles = [];
  let origin = null;
  try {
    object.traverse(child => {
      if (!child.isMesh) return;
      if (child.isSkinnedMesh || child.geometry?.morphAttributes?.position?.length) throw new TypeError('Skinned or morphing geometry must remain separate.');
      const geometry = child.geometry, position = geometry?.getAttribute('position');
      if (!position) throw new TypeError('A source surface has no position stream.');
      const normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
      const shipPosition = geometry.getAttribute('solShipPosition');
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(child.matrixWorld);
      const determinant = child.matrixWorld.determinant();
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new TypeError('A source surface has a singular transform.');
      const materialId = child.userData.solMaterialId || node.materialId || materials.keys().next().value || null;
      const nativeSurface = materials.get(materialId)?.native?.shipSurface;
      if (nativeSurface && (!shipPosition || !identityLinear(child.matrixWorld))) {
        throw new TypeError('Ship surface mapping needs translation-only source transforms. Keep this piece separate or edit its original parts.');
      }
      const indices = geometry.index;
      const count = indices ? indices.count : position.count;
      if (count % 3) throw new TypeError('A source surface has incomplete triangle topology.');
      for (let offset = 0; offset < count; offset += 3) {
        const sourceFace = node.type === 'mesh' ? node.geometry.faces[child.userData.solFaceIndices?.[offset / 3]] : null;
        const corners = [0, 1, 2].map(corner => {
          const index = indices ? indices.getX(offset + corner) : offset + corner;
          const point = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
          const direction = normal ? new THREE.Vector3().fromBufferAttribute(normal, index).applyNormalMatrix(normalMatrix) : new THREE.Vector3(0, 1, 0);
          const coordinates = uv ? [uv.getX(index), uv.getY(index)] : [0, 0];
          if (![...point.toArray(), ...direction.toArray(), ...coordinates].every(Number.isFinite)) throw new TypeError('A source surface contains non-finite attributes.');
          if (nativeSurface) {
            const old = [shipPosition.getX(index), shipPosition.getY(index), shipPosition.getZ(index)];
            const next = swizzle(point.toArray());
            const candidate = old.map((value, axis) => value - next[axis]);
            if (!candidate.every(Number.isFinite)) throw new TypeError('Ship surface coordinates are invalid.');
            if (origin && candidate.some((value, axis) => Math.abs(value - origin[axis]) > EPSILON)) throw new TypeError('Ship surface coordinates do not share a coherent object origin.');
            origin ||= candidate;
          }
          return { position: point.toArray(), normal: direction.toArray(), uv: coordinates, originalUv: [...coordinates] };
        });
        if (determinant < 0) [corners[1], corners[2]] = [corners[2], corners[1]];
        if (projection === 'box') {
          const [a, b, c] = corners.map(corner => new THREE.Vector3(...corner.position));
          const faceNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
          const absolute = faceNormal.toArray().map(Math.abs);
          const dominant = absolute[1] >= Math.max(absolute[0], absolute[2]) ? 1 : absolute[0] >= absolute[2] ? 0 : 2;
          for (const corner of corners) {
            const p = corner.position;
            corner.uv = (dominant === 1 ? [p[0], p[2]] : dominant === 0 ? [p[2], p[1]] : [p[0], p[1]]).map(value => value / textureScale);
          }
        }
        triangles.push({ corners, materialId, surfaceId: sourceFace?.surfaceId || node.surfaceId || null,
          name: sourceFace?.name || node.name });
      }
    });
    return { triangles, origin };
  } finally {
    disposeSolThreeObject(object);
    dummy.dispose();
  }
}

/** Preserve evaluated UV seams/materials by default. Box UVs are object-space,
 * metre-scaled coordinates for a shared repeating texture, not a packed atlas.
 * Moving parts, live screens and functional anchors remain separate objects.
 */
export function prepareJoinedObject(sourceDocument, rootId, {
  name = '', projection = 'preserve', textureScale = 1,
} = {}) {
  if (!['preserve', 'box'].includes(projection)) throw new TypeError('Choose Preserve UVs or Box mapping.');
  if (!Number.isFinite(textureScale) || textureScale <= 0) throw new TypeError('Texture scale must be a positive number of metres.');
  if (isJoinedObjectDocument(sourceDocument)) throw new TypeError('Edit the original parts before creating another joined version.');
  const component = extractSolComponent(sourceDocument, rootId, { name: String(name).trim() || `${sourceDocument.meta.name} joined` });
  // Component extraction normally retains clips through owned motion tracks.
  // Join also preserves event-only clips that address an owned source node.
  const included = new Set(component.nodes.map(node => node.id));
  const retainedClips = new Set(component.animations.map(clip => clip.id));
  for (const clip of sourceDocument.animations || []) {
    if (retainedClips.has(clip.id)) continue;
    const events = (clip.events || []).filter(event => event.nodeId && included.has(event.nodeId));
    if (!events.length) continue;
    const retained = deepClone(clip);
    retained.tracks = (retained.tracks || []).filter(track => included.has(track.nodeId));
    retained.events = deepClone(events);
    component.animations.push(retained);
    retainedClips.add(clip.id);
  }
  for (const mapping of sourceDocument.actionMap || []) {
    if (retainedClips.has(mapping.clipId) && !component.actionMap.some(item => item.id === mapping.id)) component.actionMap.push(deepClone(mapping));
  }
  const snapshot = deepClone(component);
  const { nodes, matrixFor } = hierarchy(component), reasonFor = exclusionReasons(component, nodes);
  const materials = new Map(component.materials.map(material => [material.id, material]));
  const vertices = [], normals = [], uvs = [], originalUvs = [], faces = [], parts = [], excluded = [], consumed = new Set();
  let shipOrigin = null;
  for (const node of component.nodes) {
    if (node.type === 'group') continue;
    const exclusion = reasonFor(node);
    if (exclusion) { excluded.push({ nodeId: node.id, name: node.name, reason: exclusion }); continue; }
    let piece;
    try { piece = evaluatedPiece(node, matrixFor(node.id), materials, projection, textureScale); }
    catch (error) {
      if (/Ship surface mapping|Ship surface coordinates do not share/.test(error.message)) {
        excluded.push({ nodeId: node.id, name: node.name, reason: error.message }); continue;
      }
      throw error;
    }
    if (piece.origin && shipOrigin && piece.origin.some((value, axis) => Math.abs(value - shipOrigin[axis]) > EPSILON)) {
      excluded.push({ nodeId: node.id, name: node.name, reason: 'Ship surface coordinates use another origin; keep this piece separate.' }); continue;
    }
    if (!piece.triangles.length) { excluded.push({ nodeId: node.id, name: node.name, reason: 'No filled visual triangles' }); continue; }
    if (vertices.length + piece.triangles.length * 3 > MAX_VERTICES) throw new RangeError('Joined object exceeds the 65,535-vertex SOL limit. Join a smaller assembly.');
    shipOrigin ||= piece.origin;
    const firstFace = faces.length;
    for (const triangle of piece.triangles) {
      const offset = vertices.length;
      for (const corner of triangle.corners) { vertices.push(corner.position); normals.push(corner.normal); uvs.push(corner.uv); originalUvs.push(corner.originalUv); }
      faces.push({ vertices: [offset, offset + 1, offset + 2], materialId: triangle.materialId,
        surfaceId: triangle.surfaceId, name: `${node.name} · ${triangle.name}` });
    }
    parts.push({ nodeId: node.id, name: node.name, firstFace, faceCount: faces.length - firstFace });
    consumed.add(node.id);
  }
  if (!parts.length) throw new TypeError(`No static visual surfaces can be joined.${excluded.length ? ` ${excluded[0].reason}.` : ''}`);
  const root = component.meta.parameters.component.rootId;
  const mesh = createSolNode({ name: `${component.meta.name} · joined surfaces`, type: 'mesh', parentId: root,
    materialId: faces[0].materialId, geometry: { vertices, faces, normals, uvs, ...(shipOrigin ? { shipOrigin } : {}) },
    tags: ['joined-static-surfaces', 'reusable-component', 'noclip'] });
  component.nodes = component.nodes.filter(node => !consumed.has(node.id));
  // Remove only empty, inert hierarchy shells. The exact chains for retained
  // animated/functional nodes are preserved, with all original local records.
  let changed = true;
  while (changed) {
    const parents = new Set(component.nodes.map(node => node.parentId));
    const previous = component.nodes.length;
    component.nodes = component.nodes.filter(node => node.id === root || node.type !== 'group'
      || parents.has(node.id) || node.sockets?.length || node.components?.length || reasonFor(node));
    changed = component.nodes.length !== previous;
  }
  component.nodes.push(mesh);
  component.meta.id = solId('model');
  component.meta.source = 'joined-object';
  component.meta.parameters.copy = { documentId: sourceDocument.meta.id };
  component.meta.parameters.joinedObject = {
    format: SOL_JOINED_OBJECT_FORMAT, version: SOL_JOINED_OBJECT_VERSION,
    meshId: mesh.id, projection, textureScale, visualOnly: true,
    partCount: parts.length, triangleCount: faces.length, vertexCount: vertices.length,
    parts, excluded, originalUvs, partTopology: faces.map(face => [...face.vertices]), sourceDocument: snapshot,
    warnings: ['Joined surfaces are a visual-only copy. Source behaviors and collider records remain separate; no gameplay collision or default assignment is inferred.'],
  };
  component.meta.parameters.component.nodeCount = component.nodes.length - 1;
  delete component.meta.parameters.component.preview;
  delete component.meta.parameters.component.previewGeometrySha256;
  component.physics.collisionMode = 'none';
  component.physics.walkable = false;
  const validation = validateSolModelDocument(component);
  if (!validation.valid) throw new TypeError(validation.errors.join(' '));
  return component;
}

/** Reproject only UVs, retaining all current geometry edits and materials.
 * Preserve restores the captured per-corner UV stream, not the source mesh.
 */
export function applyJoinedProjection(document, projection = 'preserve', textureScale = 1) {
  if (!isJoinedObjectDocument(document)) throw new TypeError('Select a joined object to change its mapping.');
  if (!['preserve', 'box'].includes(projection)) throw new TypeError('Choose Preserve UVs or Box mapping.');
  if (!Number.isFinite(textureScale) || textureScale <= 0) throw new TypeError('Texture scale must be a positive number of metres.');
  const copy = deepClone(document), metadata = copy.meta.parameters.joinedObject;
  const mesh = copy.nodes.find(node => node.id === metadata.meshId).geometry;
  if (projection === 'preserve') {
    if (!Array.isArray(metadata.originalUvs) || metadata.originalUvs.length !== mesh.vertices.length
      || metadata.originalUvs.some(uv => !Array.isArray(uv) || uv.length !== 2 || !uv.every(Number.isFinite))) {
      throw new TypeError('Topology changed: the original UV stream no longer matches these vertices. Restore the original parts or keep Box mapping.');
    }
    mesh.uvs = deepClone(metadata.originalUvs);
  } else {
    const uvs = mesh.vertices.map(() => [0, 0]);
    for (const face of mesh.faces) {
      if (!Array.isArray(face.vertices) || face.vertices.length < 3) throw new TypeError('Joined faces need at least three vertices.');
      const points = face.vertices.map(index => {
        const point = mesh.vertices[index];
        if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) throw new TypeError('Joined vertices must contain finite coordinates.');
        return new THREE.Vector3(...point);
      });
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
      const absolute = normal.toArray().map(Math.abs);
      const dominant = absolute[1] >= Math.max(absolute[0], absolute[2]) ? 1 : absolute[0] >= absolute[2] ? 0 : 2;
      for (const index of face.vertices) {
        const p = mesh.vertices[index];
        uvs[index] = (dominant === 1 ? [p[0], p[2]] : dominant === 0 ? [p[2], p[1]] : [p[0], p[1]]).map(value => value / textureScale);
      }
    }
    mesh.uvs = uvs;
  }
  metadata.projection = projection;
  metadata.textureScale = textureScale;
  return copy;
}

/** Explicitly discard joined-mesh edits and return to the saved source parts.
 * Variant/file ownership remains unchanged; this never opens the original file.
 */
export function restoreJoinedObject(document) {
  if (!isJoinedObjectDocument(document)) throw new TypeError('This object has no joined source parts to restore.');
  const source = document.meta.parameters.joinedObject.sourceDocument;
  if (!isSolComponentDocument(source)) throw new TypeError('The editable source snapshot is unavailable.');
  const restored = deepClone(source);
  const validation = validateSolModelDocument(restored);
  if (!validation.valid) throw new TypeError(validation.errors.join(' '));
  // Exercise the same checked subtree walk used by component extraction before
  // accepting a snapshot from an imported/hand-edited joined document.
  extractSolComponent(restored, restored.meta.parameters.component.rootId);
  restored.meta.id = document.meta.id;
  restored.meta.name = document.meta.name;
  restored.meta.updatedAt = new Date().toISOString();
  restored.meta.parameters.copy = deepClone(document.meta.parameters.copy || { documentId: source.meta.id });
  if (document.meta.parameters.component.category !== undefined) restored.meta.parameters.component.category = document.meta.parameters.component.category;
  const root = restored.nodes.find(node => node.id === restored.meta.parameters.component.rootId);
  root.name = restored.meta.name;
  delete restored.meta.parameters.component.preview;
  delete restored.meta.parameters.component.previewGeometrySha256;
  return restored;
}
