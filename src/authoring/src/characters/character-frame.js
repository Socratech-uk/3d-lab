const EPSILON = 1e-8;

function finiteVector(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  const result = value.slice(0, 3).map(Number);
  return result.every(Number.isFinite) ? result : [...fallback];
}

export function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale3(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

export function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalize3(vector, fallback = [0, 1, 0]) {
  const candidate = finiteVector(vector, fallback);
  const length = Math.hypot(candidate[0], candidate[1], candidate[2]);
  if (length < EPSILON) return [...fallback];
  return candidate.map(value => value / length);
}

/**
 * A character-local, gravity-aware coordinate frame.
 *
 * Local +X is the character's right, +Y is away from the floor and +Z is the
 * direction the character is facing. The constructor removes accumulated
 * floating-point skew while preserving the supplied gravity hemisphere.
 */
export class CharacterFrame {
  constructor({ origin = [0, 0, 0], right = [1, 0, 0], up = [0, 1, 0], forward = [0, 0, -1] } = {}) {
    this.origin = finiteVector(origin, [0, 0, 0]);
    this.forward = normalize3(forward, [0, 0, -1]);
    const requestedUp = normalize3(up, [0, 1, 0]);
    let projectedRight = finiteVector(right, cross3(this.forward, requestedUp));
    const alongForward = dot3(projectedRight, this.forward);
    projectedRight = [
      projectedRight[0] - this.forward[0] * alongForward,
      projectedRight[1] - this.forward[1] * alongForward,
      projectedRight[2] - this.forward[2] * alongForward,
    ];
    if (Math.hypot(...projectedRight) < EPSILON) projectedRight = cross3(this.forward, requestedUp);
    this.right = normalize3(projectedRight, [1, 0, 0]);
    this.up = normalize3(cross3(this.right, this.forward), requestedUp);
    if (dot3(this.up, requestedUp) < 0) {
      this.right = scale3(this.right, -1);
      this.up = scale3(this.up, -1);
    }
    Object.freeze(this.origin);
    Object.freeze(this.right);
    Object.freeze(this.up);
    Object.freeze(this.forward);
    Object.freeze(this);
  }

  static fromYaw(origin, yaw = 0) {
    const angle = Number.isFinite(Number(yaw)) ? Number(yaw) : 0;
    return new CharacterFrame({
      origin,
      right: [Math.cos(angle), 0, Math.sin(angle)],
      up: [0, 1, 0],
      forward: [Math.sin(angle), 0, -Math.cos(angle)],
    });
  }

  point(local = [0, 0, 0]) {
    const value = finiteVector(local, [0, 0, 0]);
    return [
      this.origin[0] + this.right[0] * value[0] + this.up[0] * value[1] + this.forward[0] * value[2],
      this.origin[1] + this.right[1] * value[0] + this.up[1] * value[1] + this.forward[1] * value[2],
      this.origin[2] + this.right[2] * value[0] + this.up[2] * value[1] + this.forward[2] * value[2],
    ];
  }

  vector(local = [0, 0, 0]) {
    const value = finiteVector(local, [0, 0, 0]);
    return [
      this.right[0] * value[0] + this.up[0] * value[1] + this.forward[0] * value[2],
      this.right[1] * value[0] + this.up[1] * value[1] + this.forward[1] * value[2],
      this.right[2] * value[0] + this.up[2] * value[1] + this.forward[2] * value[2],
    ];
  }

  at(localOrigin = [0, 0, 0]) {
    return new CharacterFrame({ origin: this.point(localOrigin), right: this.right, up: this.up, forward: this.forward });
  }
}
