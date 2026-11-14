// Shared collision against evaluated render triangles. AABBs only reject work;
// they never replace triangle contact, fill holes, or add panel thickness.
const EPS = 1e-12;
const clamp01 = value => Math.max(0, Math.min(1, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addScaled = (a, b, scale) => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = vector => Math.hypot(...vector);
const frozenVector = vector => Object.freeze(vector);

function vector3(value, label = 'point') {
  const result = Array.isArray(value) || ArrayBuffer.isView(value)
    ? [Number(value[0]), Number(value[1]), Number(value[2])]
    : [Number(value?.x), Number(value?.y), Number(value?.z)];
  if (!result.every(Number.isFinite)) throw new TypeError(`${label} must contain three finite coordinates`);
  return result;
}

function boundsFor(triangles, list) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const index of list) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], triangles[index].min[axis]);
    max[axis] = Math.max(max[axis], triangles[index].max[axis]);
  }
  return Object.freeze({ min: frozenVector(min), max: frozenVector(max) });
}

function buildTree(triangles, list) {
  const bounds = boundsFor(triangles, list);
  if (list.length <= 8) return Object.freeze({ bounds, indices: Object.freeze(list) });
  const widths = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const axis = widths.indexOf(Math.max(...widths));
  list.sort((a, b) => (triangles[a].min[axis] + triangles[a].max[axis]) - (triangles[b].min[axis] + triangles[b].max[axis]));
  const midpoint = Math.floor(list.length / 2);
  return Object.freeze({ bounds, left: buildTree(triangles, list.slice(0, midpoint)), right: buildTree(triangles, list.slice(midpoint)) });
}

/** Copies mesh coordinates into an immutable, reusable collider in the caller's
 * coordinate system. Positions may be flat arrays or xyz triplets. No transform
 * is guessed here: callers supply the same evaluated/posed world vertices used
 * by rendering. Open/compound meshes remain surfaces, never inferred volumes. */
export function createTriangleCollider({ positions, indices } = {}, options = {}) {
  if (!positions || typeof positions.length !== 'number') throw new TypeError('positions are required');
  const vertices = positions.length && (Array.isArray(positions[0]) || ArrayBuffer.isView(positions[0]))
    ? Array.from(positions, value => vector3(value, 'vertex')).flat()
    : Array.from(positions, Number);
  if (vertices.length % 3 || !vertices.every(Number.isFinite)) throw new TypeError('positions must contain finite xyz triplets');
  const count = vertices.length / 3;
  const vertexIndices = indices == null ? Array.from({ length: count }, (_, index) => index) : Array.from(indices, Number);
  if (vertexIndices.length % 3 || !vertexIndices.every(index => Number.isInteger(index) && index >= 0 && index < count)) {
    throw new TypeError('indices must contain valid triangle triplets');
  }
  const triangles = [];
  for (let offset = 0; offset < vertexIndices.length; offset += 3) {
    const points = vertexIndices.slice(offset, offset + 3).map(index => vertices.slice(index * 3, index * 3 + 3));
    const [a, b, c] = points, normal = cross(sub(b, a), sub(c, a)), magnitude = length(normal);
    // Render-degenerate triangles have no surface area and add no collision.
    if (magnitude === 0) continue;
    triangles.push(Object.freeze({
      a: frozenVector(a), b: frozenVector(b), c: frozenVector(c),
      normal: frozenVector(normal.map(value => value / magnitude)),
      min: frozenVector([0, 1, 2].map(axis => Math.min(a[axis], b[axis], c[axis]))),
      max: frozenVector([0, 1, 2].map(axis => Math.max(a[axis], b[axis], c[axis]))),
      index: offset / 3,
    }));
  }
  const tree = triangles.length ? buildTree(triangles, triangles.map((_, index) => index)) : null;
  return Object.freeze({
    positions: Object.freeze(vertices), indices: Object.freeze(vertexIndices),
    triangles: Object.freeze(triangles), triangleCount: triangles.length,
    bounds: tree?.bounds || null, tree,
    ...(options.nodeId == null ? {} : { nodeId: String(options.nodeId) }),
  });
}

function overlaps(a, b, pad = 0) {
  return [0, 1, 2].every(axis => a.min[axis] <= b.max[axis] + pad && a.max[axis] >= b.min[axis] - pad);
}

function candidates(collider, bounds, padding = 0) {
  const result = [], stack = collider?.tree ? [collider.tree] : [];
  while (stack.length) {
    const tree = stack.pop();
    if (!overlaps(tree.bounds, bounds, padding)) continue;
    if (tree.indices) result.push(...tree.indices);
    else stack.push(tree.left, tree.right);
  }
  return result;
}

function closestPointSegment(point, a, b) {
  const direction = sub(b, a), squared = dot(direction, direction);
  const t = squared > 0 ? clamp01(dot(sub(point, a), direction) / squared) : 0;
  return { point: addScaled(a, direction, t), t };
}

function closestPointTriangle(point, triangle) {
  const { a, b, c } = triangle, ab = sub(b, a), ac = sub(c, a), ap = sub(point, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(point, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return addScaled(a, ab, d1 / (d1 - d3));
  const cp = sub(point, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return addScaled(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return addScaled(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const total = va + vb + vc;
  if (total === 0) {
    return [closestPointSegment(point, a, b), closestPointSegment(point, b, c), closestPointSegment(point, c, a)]
      .sort((p, q) => dot(sub(point, p.point), sub(point, p.point)) - dot(sub(point, q.point), sub(point, q.point)))[0].point;
  }
  const v = vb / total, w = vc / total;
  return [0, 1, 2].map(axis => a[axis] + ab[axis] * v + ac[axis] * w);
}

function closestSegments(a, b, c, d) {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), uw = dot(u, w), vw = dot(v, w);
  let s = 0, t = 0;
  if (uu === 0 && vv === 0) return { segment: a, surface: c, s, t };
  if (uu === 0) t = clamp01(vw / vv);
  else if (vv === 0) s = clamp01(-uw / uu);
  else {
    const perpendicular = cross(u, v), denominator = dot(perpendicular, perpendicular);
    // Cross products avoid cancellation in uu*vv-uv*uv for almost-parallel
    // long edges. Treat only an actually parallel pair as the parallel case.
    s = denominator > 0 ? clamp01(dot(cross(v, w), perpendicular) / denominator) : 0;
    t = (uv * s + vw) / vv;
    if (t < 0) { t = 0; s = clamp01(-uw / uu); }
    else if (t > 1) { t = 1; s = clamp01((uv - uw) / uu); }
  }
  return { segment: addScaled(a, u, s), surface: addScaled(c, v, t), s, t };
}

// Two-sided Möller–Trumbore. The relative determinant tolerance is independent
// of triangle scale; tiny but valid panels are not silently discarded.
function segmentTriangleIntersection(a, b, triangle) {
  const direction = sub(b, a), edge1 = sub(triangle.b, triangle.a), edge2 = sub(triangle.c, triangle.a);
  const p = cross(direction, edge2), determinant = dot(edge1, p);
  const determinantScale = length(edge1) * length(p);
  if (Math.abs(determinant) <= EPS * determinantScale) return null;
  const inverse = 1 / determinant, offset = sub(a, triangle.a);
  const u = dot(offset, p) * inverse;
  if (u < -EPS || u > 1 + EPS) return null;
  const q = cross(offset, edge1), v = dot(direction, q) * inverse;
  if (v < -EPS || u + v > 1 + EPS) return null;
  const t = dot(edge2, q) * inverse;
  return t >= -EPS && t <= 1 + EPS ? clamp01(t) : null;
}

function closestSegmentTriangle(a, b, triangle) {
  const intersection = segmentTriangleIntersection(a, b, triangle);
  if (intersection != null) {
    const point = addScaled(a, sub(b, a), intersection);
    return { segment: point, surface: point, distance: 0, s: intersection };
  }
  const pa = closestPointTriangle(a, triangle), pb = closestPointTriangle(b, triangle);
  const pairs = [
    { segment: a, surface: pa, s: 0 }, { segment: b, surface: pb, s: 1 },
    closestSegments(a, b, triangle.a, triangle.b), closestSegments(a, b, triangle.b, triangle.c), closestSegments(a, b, triangle.c, triangle.a),
  ];
  let best = pairs[0], squared = dot(sub(best.segment, best.surface), sub(best.segment, best.surface));
  for (let index = 1; index < pairs.length; index++) {
    const pair = pairs[index], difference = sub(pair.segment, pair.surface), candidate = dot(difference, difference);
    if (candidate < squared || (candidate === squared && pair.s < best.s)) { best = pair; squared = candidate; }
  }
  return { ...best, distance: Math.sqrt(Math.max(0, squared)) };
}

function contactNormal(pair, triangle, axisStart, axisEnd, velocity) {
  if (pair.distance > 1e-14) return sub(pair.segment, pair.surface).map(value => value / pair.distance);
  const midpoint = axisStart.map((value, axis) => (value + axisEnd[axis]) * .5);
  const side = dot(sub(midpoint, triangle.a), triangle.normal);
  // For an axis intersecting a thin panel, use its initial side. At exact
  // symmetry choose the side opposing motion; winding is never a one-way gate.
  const sign = Math.abs(side) > 1e-12 ? Math.sign(side) : (dot(velocity, triangle.normal) > 0 ? -1 : 1);
  return triangle.normal.map(value => value * sign);
}

/** Earliest accepted two-sided segment hit, including coplanar edge/face
 * overlap. Filtering occurs per triangle, so a steep face cannot hide a later
 * walkable floor belonging to the same compound mesh. */
export function segmentIntersectsTriangles(from, to, collider, { minT = 0, maxT = 1, acceptHit = null } = {}) {
  const a = vector3(from, 'from'), b = vector3(to, 'to'), velocity = sub(b, a);
  const low = clamp01(Number(minT)), high = clamp01(Number(maxT));
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null;
  const bounds = { min: a.map((value, axis) => Math.min(value, b[axis])), max: a.map((value, axis) => Math.max(value, b[axis])) };
  let best = null;
  for (const index of candidates(collider, bounds, 1e-10)) {
    const triangle = collider.triangles[index];
    let t = segmentTriangleIntersection(a, b, triangle);
    if (t == null && Math.abs(dot(sub(a, triangle.a), triangle.normal)) <= 1e-10 && Math.abs(dot(sub(b, triangle.a), triangle.normal)) <= 1e-10) {
      // Clip before finding the first coplanar contact, so endpoint exclusions
      // do not suppress a later valid edge crossing.
      const clippedA = addScaled(a, velocity, low), clippedB = addScaled(a, velocity, high);
      const pair = closestSegmentTriangle(clippedA, clippedB, triangle);
      if (pair.distance <= 1e-10) t = low + (high - low) * pair.s;
    }
    if (t == null || t < low - EPS || t > high + EPS || (best && t >= best.t)) continue;
    const normal = triangle.normal.map(value => value * (dot(velocity, triangle.normal) > 0 ? -1 : 1));
    const hit = { t, normal, point: addScaled(a, velocity, t), triangleIndex: triangle.index, surfaceNormal: [...triangle.normal] };
    if (typeof acceptHit !== 'function' || acceptHit(hit)) best = hit;
  }
  return best;
}

function makeHit(t, pair, triangle, axisStart, axisEnd, velocity, radius) {
  return {
    t: clamp01(t), normal: contactNormal(pair, triangle, axisStart, axisEnd, velocity),
    point: [...pair.surface], triangleIndex: triangle.index, surfaceNormal: [...triangle.normal],
    penetration: Math.max(0, radius - pair.distance),
  };
}

function sweepTriangle(triangle, axisStart, axisEnd, velocity, radius, skin, maximum) {
  const target = radius + skin, speed = length(velocity);
  const tolerance = Math.max(1e-10, target * 1e-8);
  const velocityTolerance = Math.max(1e-14, speed * 1e-12);
  const startSide = dot(sub(axisStart, triangle.a), triangle.normal), endSide = dot(sub(axisEnd, triangle.a), triangle.normal);
  const planeDistance = startSide * endSide <= 0 ? 0 : Math.min(Math.abs(startSide), Math.abs(endSide));
  // A capsule parallel to and merely touching the physical face cannot enter
  // that triangle. This also prevents artificial edge friction at tessellation
  // seams: skin does not turn a tangent wall/floor into a lateral obstruction.
  if (Math.abs(dot(velocity, triangle.normal)) <= velocityTolerance && planeDistance >= radius - tolerance && speed > 0) return null;
  let t = 0, pair = closestSegmentTriangle(axisStart, axisEnd, triangle);
  let normal = contactNormal(pair, triangle, axisStart, axisEnd, velocity);
  if (pair.distance <= target + tolerance) {
    // Existing contact allows a tangent or outward step. A stationary true
    // penetration is exposed for the caller's bounded recovery, not hidden.
    if (-dot(velocity, normal) > velocityTolerance || (speed === 0 && pair.distance < radius - tolerance)) {
      return makeHit(0, pair, triangle, axisStart, axisEnd, velocity, radius);
    }
    return null;
  }
  // Capsule and triangle are convex; the closest-pair normal is a separating
  // plane. Advancing gap / closing speed cannot cross that plane prematurely.
  // This continuous translation query has no fixed-length steps to tunnel.
  for (let iteration = 0; iteration < 64; iteration++) {
    const closing = -dot(velocity, normal);
    if (closing <= velocityTolerance) return null;
    const advance = (pair.distance - target) / closing;
    if (t + advance > maximum + EPS) return null;
    t = Math.min(maximum, t + Math.max(0, advance));
    const start = addScaled(axisStart, velocity, t), end = addScaled(axisEnd, velocity, t);
    pair = closestSegmentTriangle(start, end, triangle);
    normal = contactNormal(pair, triangle, start, end, velocity);
    if (pair.distance <= target + tolerance) return makeHit(t, pair, triangle, start, end, velocity, radius);
  }
  // Extremely grazing contacts can converge slowly. Find the minimum of the
  // convex distance function by its derivative, then bisect the entry root.
  // This is still bounded and continuous, never a sample-spacing fallback.
  let left = t, right = maximum;
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (left + right) * .5;
    const start = addScaled(axisStart, velocity, middle), end = addScaled(axisEnd, velocity, middle);
    const candidate = closestSegmentTriangle(start, end, triangle);
    const direction = contactNormal(candidate, triangle, start, end, velocity);
    if (dot(velocity, direction) < 0) left = middle; else right = middle;
  }
  let entry = t, minimum = (left + right) * .5;
  let start = addScaled(axisStart, velocity, minimum), end = addScaled(axisEnd, velocity, minimum);
  pair = closestSegmentTriangle(start, end, triangle);
  if (pair.distance > target + tolerance) return null;
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (entry + minimum) * .5;
    start = addScaled(axisStart, velocity, middle); end = addScaled(axisEnd, velocity, middle);
    const candidate = closestSegmentTriangle(start, end, triangle);
    if (candidate.distance <= target + tolerance) minimum = middle; else entry = middle;
  }
  start = addScaled(axisStart, velocity, minimum); end = addScaled(axisEnd, velocity, minimum);
  pair = closestSegmentTriangle(start, end, triangle);
  return makeHit(minimum, pair, triangle, start, end, velocity, radius);
}

/** Continuous upright capsule translation. from/to are feet anchors; centres
 * run from radius to height-radius along upAxis (1 for SOL, 2 for ship space).
 * Two-sided render surfaces are authoritative. Skin only adds contact padding.
 * Returned point lies on the rendered triangle, and normal points toward the
 * capsule. Tangent/away movement at an existing contact is allowed. */
export function sweepCapsuleCollider(collider, from, to, { radius = .3, height = 1.8, upAxis = 1, skin = .0001, acceptHit = null } = {}) {
  const a = vector3(from, 'from'), b = vector3(to, 'to');
  radius = Number(radius); height = Number(height); skin = Number(skin);
  if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(height) || height < 0 || !Number.isFinite(skin) || skin < 0) {
    throw new TypeError('radius, height and skin must be finite and nonnegative');
  }
  if (upAxis !== 0 && upAxis !== 1 && upAxis !== 2) throw new TypeError('upAxis must be 0, 1 or 2');
  height = Math.max(height, radius * 2);
  const axisStart = [...a], axisEnd = [...a];
  axisStart[upAxis] += radius; axisEnd[upAxis] += height - radius;
  const velocity = sub(b, a), padding = radius + skin;
  const bounds = {
    min: a.map((value, axis) => Math.min(value, b[axis]) - (axis === upAxis ? skin : padding)),
    max: a.map((value, axis) => Math.max(value, b[axis]) + (axis === upAxis ? height + skin : padding)),
  };
  let best = null;
  for (const index of candidates(collider, bounds)) {
    const hit = sweepTriangle(collider.triangles[index], axisStart, axisEnd, velocity, radius, skin, best?.t ?? 1);
    if (hit && (typeof acceptHit !== 'function' || acceptHit(hit)) && (!best || hit.t < best.t || (hit.t === best.t && hit.penetration > best.penetration))) best = hit;
  }
  return best;
}
