import * as THREE from 'three';
import { createSolThreeNodeObject } from './sol-three-model.js?v=1.3.0';
import { createSolPresentationTransform } from './sol-presentation-profile.js?v=1.0.0';
import { applySolWorldPose } from './sol-world-components.js?v=1.5.0';
import { evaluateSolModelPose } from './sol-model-runtime.js';
import { createTriangleCollider, sweepCapsuleCollider, segmentIntersectsTriangles } from '../geometry/mesh-collision.js?v=1.0.0';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const finite3 = (value, fallback = [0, 0, 0]) => fallback.map((entry, axis) => finite(value?.[axis], entry));
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const NON_COLLIDING_TAGS = new Set(['noclip', 'no-clip', 'non-colliding', 'noncolliding', 'trigger-only', 'fx', 'helper']);
const UP = new THREE.Vector3(0, 1, 0);

export function nodeCollisionEnabled(node) {
  if (!node || node.type === 'group') return false;
  if (node.collision?.mode === 'mesh') return node.collision.enabled === true;
  if (node.visible === false) return false;
  const tags = new Set((node.tags || []).map(tag => String(tag).trim().toLowerCase()));
  for (const tag of NON_COLLIDING_TAGS) if (tags.has(tag)) return false;
  return true;
}

function copyExpandedBox(box, minimumThickness = .018) {
  const result = box.clone();
  const size = result.getSize(new THREE.Vector3());
  const centre = result.getCenter(new THREE.Vector3());
  if (size.x < minimumThickness) { result.min.x = centre.x - minimumThickness * .5; result.max.x = centre.x + minimumThickness * .5; }
  if (size.y < minimumThickness) { result.min.y = centre.y - minimumThickness * .5; result.max.y = centre.y + minimumThickness * .5; }
  if (size.z < minimumThickness) { result.min.z = centre.z - minimumThickness * .5; result.max.z = centre.z + minimumThickness * .5; }
  return result;
}

function objectWorldBox(object, target = new THREE.Box3()) {
  target.makeEmpty();
  object.updateWorldMatrix(true, false);
  object.traverse(child => {
    if (!child.isMesh || child.userData.solCollisionDisabled) return;
    const geometry = child.geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    if (!geometry.boundingBox) return;
    const local = child.userData.solCollisionExplicit ? geometry.boundingBox.clone() : copyExpandedBox(geometry.boundingBox);
    local.applyMatrix4(child.matrixWorld);
    target.union(local);
  });
  return target;
}

export function createSolCollisionModel(document) {
  const root = new THREE.Group();
  root.name = `SOL collision · ${document?.meta?.name || document?.meta?.id || 'model'}`;
  const presentationRoot = new THREE.Group();
  presentationRoot.name = 'SOL collision presentation root';
  root.add(presentationRoot);
  const objectById = new Map();
  const dummyMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

  for (const node of document?.nodes || []) {
    const object = createSolThreeNodeObject(node, dummyMaterial, new Map());
    object.name = node.name || node.id;
    object.userData.solNodeId = node.id;
    object.userData.solCollisionDisabled = !nodeCollisionEnabled(node);
    object.position.fromArray(finite3(node.transform?.position));
    object.rotation.set(...finite3(node.transform?.rotation));
    object.scale.fromArray(finite3(node.transform?.scale, [1, 1, 1]));
    object.traverse(child => { if (child.isMesh) child.userData.solCollisionDisabled = object.userData.solCollisionDisabled; });
    objectById.set(node.id, object);
  }
  for (const node of document?.nodes || []) {
    const object = objectById.get(node.id);
    (objectById.get(node.parentId) || presentationRoot).add(object);
  }

  const allMeshes = [], collidableMeshes = [];
  root.traverse(child => {
    if (!child.isMesh) return;
    child.geometry?.computeBoundingBox?.();
    child.geometry?.computeBoundingSphere?.();
    allMeshes.push(child);
  });

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false;
  const normalMatrix = new THREE.Matrix3();
  const scratchNormal = new THREE.Vector3();
  const scratchBox = new THREE.Box3();
  const nodeBox = new THREE.Box3();
  const collisionBoxes = new Map();
  const triangleColliders = new Map();
  let allBounds = new THREE.Box3();
  let lastPresentationKey = '';
  let lastPose = null;

  function update({ presentation = null, scale = 1, worldPose = null, animationPose = null, animationContext = null } = {}) {
    const pose = animationPose?.get ? animationPose : animationContext ? evaluateSolModelPose(document, animationContext) : null;
    const collisionOwners = new Map();
    for (const node of document?.nodes || []) {
      const object = objectById.get(node.id);
      if (!object) continue;
      const animated = pose?.get?.(node.id) || {};
      const transform = applySolWorldPose({
        position: animated.position || node.transform?.position,
        rotation: animated.rotation || node.transform?.rotation,
        scale: animated.scale || node.transform?.scale,
      }, worldPose?.get?.(node.id) || {});
      object.position.fromArray(finite3(transform.position));
      object.rotation.set(...finite3(transform.rotation));
      object.scale.fromArray(finite3(transform.scale, [1, 1, 1]));
      object.visible = node.visible !== false;
      object.userData.solCollisionDisabled = !nodeCollisionEnabled(node);
      collisionOwners.set(node.id, node);
    }
    const present = createSolPresentationTransform(presentation);
    presentationRoot.position.fromArray(present.position);
    presentationRoot.rotation.set(...present.rotation);
    presentationRoot.scale.fromArray(present.scale.map(value => value * finite(scale, 1)));
    root.updateMatrixWorld(true);
    collidableMeshes.length = 0;
    for (const mesh of allMeshes) {
      const owner = collisionOwners.get(mesh.userData.solNodeId);
      mesh.userData.solCollisionDisabled = !nodeCollisionEnabled(owner);
      mesh.userData.solCollisionExplicit = owner?.collision?.mode === 'mesh';
      if (mesh.userData.solCollisionDisabled) continue;
      collidableMeshes.push(mesh);
      if (!mesh.userData.solCollisionExplicit) continue;
      const positions = mesh.geometry?.getAttribute('position'), indices = mesh.geometry?.index;
      if (!positions) continue;
      const key = [...mesh.matrixWorld.elements, positions.version, positions.count, indices?.version || 0, indices?.count || 0].join(',');
      const previous = triangleColliders.get(mesh);
      if (previous?.geometry === mesh.geometry && previous.key === key) continue;
      const worldPositions = [];
      for (let index = 0; index < positions.count; index += 1) worldPositions.push(...new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld).toArray());
      const worldIndices = indices ? Array.from({ length: indices.count }, (_, index) => indices.getX(index)) : undefined;
      triangleColliders.set(mesh, { geometry: mesh.geometry, key,
        collider: createTriangleCollider({ positions: worldPositions, indices: worldIndices }, { nodeId: mesh.userData.solNodeId }) });
    }
    allBounds = objectWorldBox(presentationRoot, new THREE.Box3());
    collisionBoxes.clear();
    for (const mesh of collidableMeshes) collisionBoxes.set(mesh, objectWorldBox(mesh, new THREE.Box3()));
    lastPresentationKey = JSON.stringify([present.position, present.rotation, present.scale, finite(scale, 1)]);
    lastPose = worldPose;
    return api;
  }

  function exactCollider(mesh) { return mesh.userData.solCollisionExplicit ? triangleColliders.get(mesh)?.collider : null; }

  /** Swept triangle narrow phase; bounding boxes inside the shared collider are
   * broad phase only. Legacy implicit nodes retain their original box behavior.
   */
  function resolveExactMotion(from, to, { radius, height, axes = [0, 1, 2], accept = () => true, include = () => true } = {}) {
    let point = finite3(from), delta = finite3(to).map((value, axis) => value - point[axis]);
    for (let pass = 0; pass < 4; pass += 1) {
      let first = null;
      for (const mesh of collidableMeshes) {
        const collider = exactCollider(mesh);
        if (!collider || !include(mesh)) continue;
        const hit = sweepCapsuleCollider(collider, point, point.map((value, axis) => value + delta[axis]), { radius, height, upAxis: 1, skin: .0001, acceptHit: accept });
        if (hit && accept(hit) && (!first || hit.t < first.t)) first = hit;
      }
      if (!first) { point = point.map((value, axis) => value + delta[axis]); break; }
      const t = Math.max(0, Math.min(1, first.t));
      point = point.map((value, axis) => value + delta[axis] * t);
      delta = delta.map(value => value * (1 - t));
      const normal = first.normal.map((value, axis) => axes.includes(axis) ? value : 0);
      const length = Math.hypot(...normal);
      if (length < 1e-8) break;
      const direction = normal.map(value => value / length);
      const push = Math.max(.0001, finite(first.penetration, 0) + .0001);
      point = point.map((value, axis) => value + direction[axis] * push);
      const into = Math.min(0, delta.reduce((sum, value, axis) => sum + value * direction[axis], 0));
      delta = delta.map((value, axis) => value - direction[axis] * into);
      if (Math.hypot(...delta) < 1e-8) break;
    }
    return point;
  }

  function bounds() {
    return allBounds.isEmpty() ? null : {
      min: allBounds.min.toArray(),
      max: allBounds.max.toArray(),
      size: allBounds.getSize(new THREE.Vector3()).toArray(),
      center: allBounds.getCenter(new THREE.Vector3()).toArray(),
    };
  }

  function nodePoint(nodeId, socketId = '') {
    const object = objectById.get(String(nodeId || ''));
    if (!object) return null;
    const node = (document?.nodes || []).find(entry => String(entry.id) === String(nodeId));
    let point = new THREE.Vector3(0, 0, 0);
    if (socketId && node?.sockets?.length) {
      const socket = node.sockets.find(entry => String(entry.id) === String(socketId));
      if (socket) point.fromArray(finite3(socket.position));
    }
    object.localToWorld(point);
    return point.toArray();
  }

  function nodeDirection(nodeId, socketId = '') {
    const object = objectById.get(String(nodeId || ''));
    if (!object) return [0, 0, -1];
    const node = (document?.nodes || []).find(entry => String(entry.id) === String(nodeId));
    const socket = socketId ? node?.sockets?.find(entry => String(entry.id) === String(socketId)) : null;
    const local = new THREE.Vector3(0, 0, -1);
    if (socket?.rotation) {
      const euler = new THREE.Euler(...finite3(socket.rotation), 'XYZ');
      local.applyEuler(euler);
    }
    local.transformDirection(object.matrixWorld).normalize();
    return local.toArray();
  }

  function nodeVector(nodeId, vector = [0, 0, 0], socketId = '') {
    const object = objectById.get(String(nodeId || ''));
    if (!object) return finite3(vector);
    const node = (document?.nodes || []).find(entry => String(entry.id) === String(nodeId));
    const socket = socketId ? node?.sockets?.find(entry => String(entry.id) === String(socketId)) : null;
    const rotation = socket?.rotation ? new THREE.Euler(...finite3(socket.rotation), 'XYZ') : null;
    const basis = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)].map(axis => {
      if (rotation) axis.applyEuler(rotation);
      return axis.transformDirection(object.matrixWorld).normalize();
    });
    const source = finite3(vector);
    return [0,1,2].map(axis => basis[0].getComponent(axis)*source[0] + basis[1].getComponent(axis)*source[1] + basis[2].getComponent(axis)*source[2]);
  }

  const interactionUnitBox = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5));
  const zoneMatrix = new THREE.Matrix4();
  const zoneInverse = new THREE.Matrix4();
  const zonePosition = new THREE.Vector3();
  const zoneQuaternion = new THREE.Quaternion();
  const zoneScale = new THREE.Vector3();
  const zoneEuler = new THREE.Euler();
  const zoneRay = new THREE.Ray();
  const zoneHit = new THREE.Vector3();

  function interactionZoneMatrix(zone, target = zoneMatrix) {
    zonePosition.fromArray(finite3(zone?.center, [0, 0, 0]));
    zoneEuler.set(...finite3(zone?.rotation, [0, 0, 0]), 'XYZ');
    zoneQuaternion.setFromEuler(zoneEuler);
    zoneScale.fromArray(finite3(zone?.size, [1, 1, 1]).map(value => Math.max(.05, Math.abs(value))));
    target.compose(zonePosition, zoneQuaternion, zoneScale);
    return target.premultiply(presentationRoot.matrixWorld);
  }

  function interactionZoneContains(zone, point) {
    interactionZoneMatrix(zone, zoneMatrix);
    zoneInverse.copy(zoneMatrix).invert();
    const local = new THREE.Vector3().fromArray(finite3(point)).applyMatrix4(zoneInverse);
    return Math.abs(local.x) <= .5 && Math.abs(local.y) <= .5 && Math.abs(local.z) <= .5;
  }

  function intersectsInteractionZone(zone, origin, direction, maxDistance = 12) {
    interactionZoneMatrix(zone, zoneMatrix);
    zoneInverse.copy(zoneMatrix).invert();
    const sourceOrigin = new THREE.Vector3().fromArray(finite3(origin));
    const sourceDirection = new THREE.Vector3().fromArray(finite3(direction, [0, 0, -1])).normalize();
    const localOrigin = sourceOrigin.clone().applyMatrix4(zoneInverse);
    const localDirection = sourceDirection.clone().transformDirection(zoneInverse).normalize();
    zoneRay.set(localOrigin, localDirection);
    const localHit = zoneRay.intersectBox(interactionUnitBox, zoneHit);
    if (!localHit) return null;
    const point = localHit.clone().applyMatrix4(zoneMatrix);
    const delta = point.clone().sub(sourceOrigin);
    const distance = delta.dot(sourceDirection);
    if (distance < 0 || distance > Math.max(.01, finite(maxDistance, 12))) return null;
    return { distance, point: point.toArray() };
  }

  function raycastDownMeshes(meshes, x, z, { fromY = 1000, toY = -1000, walkableNormalY = .18 } = {}) {
    if (!meshes?.length) return null;
    const high = Math.max(fromY, toY), low = Math.min(fromY, toY), distance = Math.max(.001, high - low);
    raycaster.set(new THREE.Vector3(finite(x), high, finite(z)), new THREE.Vector3(0, -1, 0));
    raycaster.near = 0;
    raycaster.far = distance;
    let exact = null;
    for (const mesh of meshes) {
      const collider = exactCollider(mesh);
      if (!collider) continue;
      // Filter each triangle before selecting the nearest accepted support.
      // A steep panel must not hide the floor beneath it in a compound mesh.
      const hit = segmentIntersectsTriangles([finite(x), high, finite(z)], [finite(x), low, finite(z)], collider,
        { acceptHit: candidate => candidate.normal[1] >= walkableNormalY });
      if (hit && (!exact || hit.point[1] > exact.y)) exact = { y: hit.point[1], point: [...hit.point], normal: [...hit.normal], nodeId: mesh.userData.solNodeId || '' };
    }
    const hits = raycaster.intersectObjects(meshes.filter(mesh => !mesh.userData.solCollisionExplicit), false);
    for (const hit of hits) {
      if (!hit.face) continue;
      normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      scratchNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
      if (scratchNormal.y < walkableNormalY) continue;
      const legacy = { y: hit.point.y, point: hit.point.toArray(), normal: scratchNormal.toArray(), nodeId: hit.object.userData.solNodeId || '' };
      return exact && exact.y > legacy.y ? exact : legacy;
    }
    return exact;
  }

  function raycastDown(x, z, options = {}) {
    return raycastDownMeshes(collidableMeshes, x, z, options);
  }

  function walkableSurfaceUnderFootprint(mesh, position, previous, {
    radius = .34,
    footY = position?.[1] || 0,
    stepHeight = .46,
  } = {}) {
    const next = finite3(position), before = finite3(previous, next);
    const r = Math.max(.01, finite(radius, .34));
    const dx = next[0] - before[0], dz = next[2] - before[2], travel = Math.hypot(dx, dz);
    const fx = travel > 1e-7 ? dx / travel : 1, fz = travel > 1e-7 ? dz / travel : 0;
    const sx = -fz, sz = fx;
    // The leading edge matters most: a capsule touches a ramp before its centre
    // is over the first triangle. Side samples stop a diagonal approach from
    // being rejected by the ramp's broad-phase AABB.
    const offsets = [
      [0, 0],
      [fx * r * .86, fz * r * .86],
      [fx * r * .62 + sx * r * .55, fz * r * .62 + sz * r * .55],
      [fx * r * .62 - sx * r * .55, fz * r * .62 - sz * r * .55],
      [sx * r * .72, sz * r * .72],
      [-sx * r * .72, -sz * r * .72],
    ];
    let best = null;
    const feet = finite(footY, next[1]);
    for (const [ox, oz] of offsets) {
      const hit = raycastDownMeshes([mesh], next[0] + ox, next[2] + oz, {
        fromY: feet + stepHeight + .10,
        toY: feet - .16,
        walkableNormalY: .18,
      });
      if (!hit || hit.y < feet - .16 || hit.y > feet + stepHeight + .05) continue;
      if (!best || hit.y > best.y) best = hit;
    }
    return best;
  }

  function horizontalBlock(position, previous, {
    radius = .34,
    footY = position?.[1] || 0,
    bodyHeight = 1.72,
    stepHeight = .46,
    walkable = true,
  } = {}) {
    const next = finite3(position), before = finite3(previous, next), feet = finite(footY, next[1]);
    const head = feet + Math.max(.4, finite(bodyHeight, 1.72));
    const r = Math.max(.01, finite(radius, .34));
    // A floor's edge/seam contact can have a lateral radial response normal.
    // Use its actual triangle plane to classify support without hiding a later
    // wall from the same compound object.
    const exact = resolveExactMotion(before, next, { radius: r, height: Math.max(.4, finite(bodyHeight, 1.72)), axes: [0, 2],
      accept: hit => Math.hypot(hit.normal[0], hit.normal[2]) > .001
        && !(walkable !== false && Math.abs(hit.surfaceNormal?.[1] ?? hit.normal[1]) > .18
          && hit.point[1] <= feet + stepHeight + .05),
    });
    let changed = Math.abs(exact[0] - next[0]) > 1e-8 || Math.abs(exact[2] - next[2]) > 1e-8;
    let x = exact[0], z = exact[2];
    for (const mesh of collidableMeshes) {
      if (mesh.userData.solCollisionExplicit) continue;
      if (!mesh.visible) continue;
      const box = collisionBoxes.get(mesh) || objectWorldBox(mesh, scratchBox);
      if (box.isEmpty()) continue;
      // A rotated ramp/roof can have a tall AABB even though the real triangle
      // under the next foot position rises only a few centimetres. Resolving the
      // AABB first turns every slope into an invisible vertical wall. Ask the
      // actual mesh surface before side-blocking; support() owns the final lift.
      if (walkable !== false) {
        const walkSurface = walkableSurfaceUnderFootprint(mesh, [x, next[1], z], before, {
          radius: r,
          footY: feet,
          stepHeight,
        });
        if (walkSurface) continue;
      }
      // Flat low boxes remain step-able without requiring a triangle sample at
      // the capsule centre (the edge samples in support() own final grounding).
      const top = box.max.y;
      if (top >= feet - .05 && top <= feet + stepHeight) continue;
      if (head <= box.min.y + .02 || feet >= box.max.y - .02) continue;
      const minX = box.min.x - r, maxX = box.max.x + r, minZ = box.min.z - r, maxZ = box.max.z + r;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const penetrations = [
        { axis: 'x', value: minX - x, amount: Math.abs(x - minX) },
        { axis: 'x', value: maxX - x, amount: Math.abs(maxX - x) },
        { axis: 'z', value: minZ - z, amount: Math.abs(z - minZ) },
        { axis: 'z', value: maxZ - z, amount: Math.abs(maxZ - z) },
      ].sort((a, b) => a.amount - b.amount);
      let choice = penetrations[0];
      const wasInside = before[0] >= minX && before[0] <= maxX && before[2] >= minZ && before[2] <= maxZ;
      if (!wasInside) {
        if (before[0] < minX) choice = { axis: 'x', value: minX - x };
        else if (before[0] > maxX) choice = { axis: 'x', value: maxX - x };
        else if (before[2] < minZ) choice = { axis: 'z', value: minZ - z };
        else if (before[2] > maxZ) choice = { axis: 'z', value: maxZ - z };
      }
      if (choice.axis === 'x') x += choice.value; else z += choice.value;
      changed = true;
    }
    return changed ? [x, next[1], z] : next;
  }

  function verticalBlock(position, previous, { radius = .34, bodyHeight = 1.72 } = {}) {
    const next = finite3(position), before = finite3(previous, next), r = Math.max(.01, finite(radius, .34)), height = Math.max(.4, finite(bodyHeight, 1.72));
    const exact = resolveExactMotion(before, next, { radius: r, height, axes: [1], accept: hit => Math.abs(hit.normal[1]) > .001 });
    let y = exact[1], changed = Math.abs(y - next[1]) > 1e-8;
    const previousHead = before[1] + height, nextHead = next[1] + height;
    for (const mesh of collidableMeshes) {
      if (mesh.userData.solCollisionExplicit) continue;
      if (!mesh.visible) continue;
      const box = collisionBoxes.get(mesh) || objectWorldBox(mesh, scratchBox);
      if (box.isEmpty()) continue;
      if (next[0] < box.min.x - r || next[0] > box.max.x + r || next[2] < box.min.z - r || next[2] > box.max.z + r) continue;
      if (previousHead <= box.min.y + .03 && nextHead > box.min.y) {
        y = Math.min(y, box.min.y - height - .012);
        changed = true;
      }
    }
    return changed ? [next[0], y, next[2]] : next;
  }

  function sphereBlock(position, previous, { radius = .34 } = {}) {
    const next = finite3(position), before = finite3(previous, next), r = Math.max(.01, finite(radius, .34));
    const from = [...before], to = [...next]; from[1] -= r; to[1] -= r;
    const exact = resolveExactMotion(from, to, { radius: r, height: r * 2 }); exact[1] += r;
    let resolved = exact, changed = exact.some((value, axis) => Math.abs(value - next[axis]) > 1e-8);
    for (const mesh of collidableMeshes) {
      if (mesh.userData.solCollisionExplicit) continue;
      if (!mesh.visible) continue;
      const box = collisionBoxes.get(mesh) || objectWorldBox(mesh, scratchBox);
      if (box.isEmpty()) continue;
      const min = [box.min.x - r, box.min.y - r, box.min.z - r], max = [box.max.x + r, box.max.y + r, box.max.z + r];
      if (resolved[0] < min[0] || resolved[0] > max[0] || resolved[1] < min[1] || resolved[1] > max[1] || resolved[2] < min[2] || resolved[2] > max[2]) continue;
      const candidates = [];
      for (let axis = 0; axis < 3; axis++) {
        candidates.push({ axis, value: min[axis] - resolved[axis], amount: Math.abs(resolved[axis] - min[axis]) });
        candidates.push({ axis, value: max[axis] - resolved[axis], amount: Math.abs(max[axis] - resolved[axis]) });
      }
      let choice = candidates.sort((a, b) => a.amount - b.amount)[0];
      const beforeInside = before.every((value, axis) => value >= min[axis] && value <= max[axis]);
      if (!beforeInside) {
        for (let axis = 0; axis < 3; axis++) {
          if (before[axis] < min[axis]) { choice = { axis, value: min[axis] - resolved[axis] }; break; }
          if (before[axis] > max[axis]) { choice = { axis, value: max[axis] - resolved[axis] }; break; }
        }
      }
      resolved[choice.axis] += choice.value;
      changed = true;
    }
    return changed ? resolved : next;
  }

  function support(position, previous, {
    radius = .34,
    stepHeight = .46,
    snapDown = .30,
    falling = true,
  } = {}) {
    const next = finite3(position), before = finite3(previous, next);
    const fromY = Math.max(before[1] + stepHeight + .12, next[1] + stepHeight + .12);
    const toY = next[1] - Math.max(.05, snapDown);
    const offsets = [[0,0],[radius*.68,0],[-radius*.68,0],[0,radius*.68],[0,-radius*.68]];
    let best = null;
    for (const [ox, oz] of offsets) {
      const hit = raycastDown(next[0] + ox, next[2] + oz, { fromY, toY });
      if (!hit) continue;
      if (!best || hit.y > best.y) best = hit;
    }
    if (!best) return null;
    const rise = best.y - before[1];
    if (rise > stepHeight + .04) return null;
    if (!falling && best.y < next[1] - snapDown) return null;
    return best;
  }

  function intersectsRay(origin, direction, maxDistance = 8) {
    if (!collidableMeshes.length) return null;
    const o = new THREE.Vector3().fromArray(finite3(origin));
    const d = new THREE.Vector3().fromArray(finite3(direction, [0,0,-1])).normalize();
    raycaster.set(o, d); raycaster.near = 0; raycaster.far = Math.max(.01, finite(maxDistance, 8));
    const distance = Math.max(.01, finite(maxDistance, 8)), end = o.clone().addScaledVector(d, distance);
    let exact = null;
    for (const mesh of collidableMeshes) {
      const collider = exactCollider(mesh); if (!collider) continue;
      const hit = segmentIntersectsTriangles(o.toArray(), end.toArray(), collider);
      if (hit && (!exact || hit.t * distance < exact.distance)) exact = { distance: hit.t * distance, point: [...hit.point], nodeId: mesh.userData.solNodeId || '' };
    }
    const hits = raycaster.intersectObjects(collidableMeshes.filter(mesh => !mesh.userData.solCollisionExplicit), false);
    const hit = hits[0];
    const legacy = hit ? { distance: hit.distance, point: hit.point.toArray(), nodeId: hit.object.userData.solNodeId || '' } : null;
    return exact && (!legacy || exact.distance < legacy.distance) ? exact : legacy;
  }

  function dispose() {
    root.traverse(child => {
      child.geometry?.dispose?.();
      if (child.material && child.material !== dummyMaterial) child.material.dispose?.();
    });
    dummyMaterial.dispose?.();
    objectById.clear();
    collisionBoxes.clear();
    triangleColliders.clear();
    collidableMeshes.length = 0;
  }

  const api = {
    root,
    presentationRoot,
    objectById,
    update,
    bounds,
    nodePoint,
    nodeDirection,
    nodeVector,
    raycastDown,
    horizontalBlock,
    verticalBlock,
    sphereBlock,
    support,
    intersectsRay,
    interactionZoneContains,
    intersectsInteractionZone,
    trianglePositions(nodeId = '') {
      return collidableMeshes.filter(mesh => !nodeId || mesh.userData.solNodeId === nodeId).flatMap(mesh => {
        const collider = exactCollider(mesh);
        return collider ? [{ nodeId: mesh.userData.solNodeId, positions: Array.from(collider.positions), indices: Array.from(collider.indices) }] : [];
      });
    },
    dispose,
    diagnostics() { return { meshes: collidableMeshes.length, exactMeshes: collidableMeshes.filter(mesh => mesh.userData.solCollisionExplicit).length,
      exactTriangles: collidableMeshes.reduce((sum, mesh) => sum + (exactCollider(mesh)?.triangleCount || 0), 0),
      bounds: bounds(), lastPresentationKey, hasWorldPose: Boolean(lastPose) }; },
  };
  update();
  return api;
}
