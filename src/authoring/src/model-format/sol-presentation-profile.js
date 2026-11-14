const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const vector = (value, fallback) => fallback.map((entry, axis) => finite(value?.[axis], entry));

export const SOL_PRESENTATION_CONTEXTS = Object.freeze([
  'object', 'character', 'weaponFirstPerson', 'weaponThirdPerson', 'ship',
]);

export function createSolPresentationTransform(input = {}) {
  input = input && typeof input === 'object' ? input : {};
  return {
    position: vector(input.position, [0, 0, 0]),
    rotation: vector(input.rotation, [0, 0, 0]),
    scale: vector(input.scale, [1, 1, 1]).map(value => Math.abs(value) < 1e-6 ? 1 : value),
  };
}

export function createSolPresentationProfile(input = {}) {
  const contexts = {};
  for (const context of SOL_PRESENTATION_CONTEXTS) contexts[context] = createSolPresentationTransform(input.contexts?.[context]);
  return {
    version: 1,
    contexts,
    viewmodel: {
      fov: Math.min(100, Math.max(20, finite(input.viewmodel?.fov, 48))),
      safeNear: Math.min(2, Math.max(.04, finite(input.viewmodel?.safeNear, .5))),
    },
  };
}

export function composeSolPresentationTransforms(base, override) {
  const first = createSolPresentationTransform(base);
  const second = createSolPresentationTransform(override);
  return {
    position: first.position.map((value, axis) => value + second.position[axis]),
    rotation: first.rotation.map((value, axis) => value + second.rotation[axis]),
    scale: first.scale.map((value, axis) => value * second.scale[axis]),
  };
}

export function solPresentationFor(profile, context, override = null) {
  const normalised = createSolPresentationProfile(profile);
  return composeSolPresentationTransforms(normalised.contexts[context], override);
}

function quaternion(rotation) {
  const [x, y, z] = vector(rotation, [0, 0, 0]);
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

function rotate(point, value) {
  const [x, y, z] = point, [qx, qy, qz, qw] = value;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

export function transformSolPoint(point, transform) {
  const value = createSolPresentationTransform(transform);
  const scaled = vector(point, [0, 0, 0]).map((entry, axis) => entry * value.scale[axis]);
  return rotate(scaled, quaternion(value.rotation)).map((entry, axis) => entry + value.position[axis]);
}

export function transformSolBounds(bounds, transform) {
  if (!bounds?.min || !bounds?.max) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  const points = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
    points.push(transformSolPoint([x, y, z], transform));
  }
  const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
  return {
    min,
    max,
    size: max.map((value, axis) => value - min[axis]),
    center: max.map((value, axis) => (value + min[axis]) * .5),
  };
}
