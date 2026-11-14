export const SOL_WORLD_COMPONENT_FORMAT = 'sol-world-components';
export const SOL_WORLD_COMPONENT_VERSION = 4;

export const SOL_ITEM_CATEGORIES = Object.freeze([
  'weapon', 'ammo', 'medical', 'food', 'cargo', 'tool', 'component',
  'clothing', 'credits', 'key', 'mission', 'custom',
]);

export const SOL_WORLD_COMPONENT_TYPES = Object.freeze([
  'interact', 'interaction-zone', 'hinge', 'slider', 'seat', 'equippable', 'inventory',
  'item-spawn', 'thruster', 'mover', 'trigger',
]);

export const SOL_WORLD_COMPONENT_LABELS = Object.freeze({
  interact: 'Use / interact',
  'interaction-zone': 'Interaction zone',
  hinge: 'Hinge',
  slider: 'Sliding mechanism',
  seat: 'Seat / station',
  equippable: 'Equip / pickup',
  inventory: 'Inventory / storage',
  'item-spawn': 'Item placement',
  thruster: 'Thrust / propulsion',
  mover: 'Movement / motor',
  trigger: 'Trigger / signal',
});

// Hinge motion presets are deliberately expressed in the node's LOCAL axes.
// They are authoring shortcuts, not hidden runtime behaviour: applying one only
// fills the same editable axis/angle fields used by Custom.  This keeps the
// result transparent and lets a Designer user fine-tune every degree afterward.
export const SOL_HINGE_MOTION_PRESETS = Object.freeze({
  custom: Object.freeze({ label: 'Custom' }),
  'swing-left': Object.freeze({ label: 'Swing left', axis: Object.freeze([0, 1, 0]), openAngle: Math.PI / 2 }),
  'swing-right': Object.freeze({ label: 'Swing right', axis: Object.freeze([0, 1, 0]), openAngle: -Math.PI / 2 }),
  'flip-up': Object.freeze({ label: 'Flip up', axis: Object.freeze([1, 0, 0]), openAngle: Math.PI / 2 }),
  'flip-down': Object.freeze({ label: 'Flip down', axis: Object.freeze([1, 0, 0]), openAngle: -Math.PI / 2 }),
  'flip-over': Object.freeze({ label: 'Flip over', axis: Object.freeze([1, 0, 0]), openAngle: Math.PI }),
  'spin-cw': Object.freeze({ label: 'Spin clockwise', axis: Object.freeze([0, 0, 1]), openAngle: -Math.PI / 2 }),
  'spin-ccw': Object.freeze({ label: 'Spin anticlockwise', axis: Object.freeze([0, 0, 1]), openAngle: Math.PI / 2 }),
  'flip-spin': Object.freeze({
    label: 'Flip + spin',
    axis: Object.freeze([1, 0, 0]),
    openAngle: Math.PI / 2,
    secondaryAxis: Object.freeze([0, 0, 1]),
    secondaryOpenAngle: Math.PI / 2,
  }),
});

export const SOL_HINGE_MOTION_PRESET_IDS = Object.freeze(Object.keys(SOL_HINGE_MOTION_PRESETS));

let componentSerial = 0;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => String(value ?? '').trim() || fallback;
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const vec3 = (value, fallback = [0, 0, 0]) => fallback.map((entry, index) => finite(value?.[index], entry));
const strings = value => Array.isArray(value) ? value.map(entry => String(entry).trim()).filter(Boolean) : [];

function componentId(type = 'component') {
  componentSerial += 1;
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8)
    || Date.now().toString(36) + componentSerial.toString(36);
  return type + '-' + suffix;
}

function common(type, overrides) {
  return {
    id: text(overrides.id, componentId(type)),
    type,
    name: text(overrides.name, SOL_WORLD_COMPONENT_LABELS[type] || type),
    enabled: overrides.enabled !== false,
  };
}

export function createSolItemPlacement(overrides = {}) {
  const selection = ['specific', 'random-category', 'random-list'].includes(overrides.selection)
    ? overrides.selection : 'specific';
  return {
    selection,
    category: SOL_ITEM_CATEGORIES.includes(overrides.category) ? overrides.category : 'weapon',
    itemId: text(overrides.itemId, ''),
    itemPool: strings(overrides.itemPool),
    socketId: text(overrides.socketId, ''),
    quantityMin: Math.max(0, Math.round(finite(overrides.quantityMin, 1))),
    quantityMax: Math.max(0, Math.round(finite(overrides.quantityMax, overrides.quantityMin ?? 1))),
    chance: clamp(overrides.chance ?? 1, 0, 1),
    respawnSeconds: Math.max(0, finite(overrides.respawnSeconds, 0)),
  };
}

export function createSolWorldComponent(type = 'interact', overrides = {}) {
  const resolved = SOL_WORLD_COMPONENT_TYPES.includes(type) ? type : 'interact';
  const base = common(resolved, overrides);
  if (resolved === 'interact') return {
    ...base,
    prompt: text(overrides.prompt, 'Use'),
    input: ['use', 'alternate', 'touch', 'proximity'].includes(overrides.input) ? overrides.input : 'use',
    range: Math.max(.1, finite(overrides.range, 2.5)),
    holdDuration: Math.max(0, finite(overrides.holdDuration, 0)),
    cooldown: Math.max(0, finite(overrides.cooldown, .15)),
    targetMode: ['toggle', 'open', 'close', 'activate'].includes(overrides.targetMode) ? overrides.targetMode : 'toggle',
    targetNodeIds: strings(overrides.targetNodeIds),
    requiresItem: text(overrides.requiresItem, ''),
    lockedMessage: text(overrides.lockedMessage, 'Locked'),
  };
  if (resolved === 'interaction-zone') return {
    ...base,
    shape: ['box'].includes(overrides.shape) ? overrides.shape : 'box',
    center: vec3(overrides.center, [0, 0, 0]),
    rotation: vec3(overrides.rotation, [0, 0, 0]),
    size: vec3(overrides.size, [3, 2.2, 4]).map(value => Math.max(.05, Math.abs(value))),
    activation: ['inside', 'look', 'inside-or-look'].includes(overrides.activation) ? overrides.activation : 'inside-or-look',
    targetNodeId: text(overrides.targetNodeId, ''),
    targetComponentId: text(overrides.targetComponentId, ''),
    maxLookDistance: Math.max(.1, finite(overrides.maxLookDistance, 12)),
  };
  if (resolved === 'hinge') return {
    ...base,
    motionPreset: SOL_HINGE_MOTION_PRESET_IDS.includes(overrides.motionPreset) ? overrides.motionPreset : 'custom',
    axis: vec3(overrides.axis, [0, 1, 0]),
    pivot: vec3(overrides.pivot, [0, 0, 0]),
    closedAngle: finite(overrides.closedAngle, 0),
    openAngle: finite(overrides.openAngle, Math.PI / 2),
    secondaryAxis: vec3(overrides.secondaryAxis, [0, 0, 1]),
    secondaryClosedAngle: finite(overrides.secondaryClosedAngle, 0),
    secondaryOpenAngle: finite(overrides.secondaryOpenAngle, 0),
    duration: Math.max(.01, finite(overrides.duration, .8)),
    easing: ['linear', 'smooth', 'mechanical'].includes(overrides.easing) ? overrides.easing : 'smooth',
    defaultOpen: Boolean(overrides.defaultOpen),
    autoCloseDelay: Math.max(0, finite(overrides.autoCloseDelay, 0)),
    collisionFollows: overrides.collisionFollows !== false,
  };
  if (resolved === 'slider') return {
    ...base,
    axis: vec3(overrides.axis, [0, 1, 0]),
    closedDistance: finite(overrides.closedDistance, 0),
    openDistance: finite(overrides.openDistance, 2),
    duration: Math.max(.01, finite(overrides.duration, .8)),
    easing: ['linear', 'smooth', 'mechanical'].includes(overrides.easing) ? overrides.easing : 'smooth',
    defaultOpen: Boolean(overrides.defaultOpen),
    autoCloseDelay: Math.max(0, finite(overrides.autoCloseDelay, 0)),
    collisionFollows: overrides.collisionFollows !== false,
  };
  if (resolved === 'seat') {
    const role = ['pilot', 'passenger', 'operator', 'gunner', 'clerk', 'driver'].includes(overrides.role) ? overrides.role : 'passenger';
    return {
      ...base,
      role,
      socketId: text(overrides.socketId, ''),
      eyeOffset: vec3(overrides.eyeOffset, [0, .78, 0]),
      exitOffset: vec3(overrides.exitOffset, [0, 0, 1.2]),
      controlMode: ['none', 'vehicle', 'turret', 'station'].includes(overrides.controlMode)
        ? overrides.controlMode : ['pilot', 'driver'].includes(role) ? 'vehicle' : role === 'gunner' ? 'turret' : 'none',
      lockView: Boolean(overrides.lockView),
      exitOnUse: overrides.exitOnUse !== false,
    };
  }
  if (resolved === 'equippable') return {
    ...base,
    itemId: text(overrides.itemId, 'item'),
    category: SOL_ITEM_CATEGORIES.includes(overrides.category) ? overrides.category : 'custom',
    slot: ['primary', 'secondary', 'tool', 'outfit', 'hands', 'cargo'].includes(overrides.slot) ? overrides.slot : 'hands',
    quantity: Math.max(1, Math.round(finite(overrides.quantity, 1))),
    removeOnEquip: overrides.removeOnEquip !== false,
  };
  if (resolved === 'inventory') return {
    ...base,
    inventoryId: text(overrides.inventoryId, 'storage'),
    capacity: Math.max(1, Math.round(finite(overrides.capacity, 24))),
    categories: strings(overrides.categories).filter(category => SOL_ITEM_CATEGORIES.includes(category)),
    access: ['public', 'owner', 'faction', 'locked'].includes(overrides.access) ? overrides.access : 'public',
    restockSeconds: Math.max(0, finite(overrides.restockSeconds, 0)),
    items: Array.isArray(overrides.items) ? overrides.items.map(createSolItemPlacement) : [],
  };
  if (resolved === 'item-spawn') return { ...base, ...createSolItemPlacement(overrides) };
  if (resolved === 'thruster') return {
    ...base,
    axis: vec3(overrides.axis, [0, 0, -1]),
    input: text(overrides.input, 'thrust-forward'),
    force: Math.max(0, finite(overrides.force, 1000)),
    maxSpeed: Math.max(0, finite(overrides.maxSpeed, 100)),
    response: Math.max(.01, finite(overrides.response, 4)),
    reverse: Boolean(overrides.reverse),
    requiresPower: overrides.requiresPower !== false,
  };
  if (resolved === 'mover') return {
    ...base,
    mode: ['translate', 'rotate'].includes(overrides.mode) ? overrides.mode : 'translate',
    axis: vec3(overrides.axis, [0, 1, 0]),
    input: text(overrides.input, 'auto'),
    speed: finite(overrides.speed, 1),
    distance: Math.max(0, finite(overrides.distance, 2)),
    loop: ['once', 'repeat', 'ping-pong'].includes(overrides.loop) ? overrides.loop : 'ping-pong',
    autoStart: overrides.autoStart !== false,
  };
  return {
    ...base,
    event: text(overrides.event, 'activate'),
    targetNodeIds: strings(overrides.targetNodeIds),
    payload: overrides.payload && typeof overrides.payload === 'object' ? clone(overrides.payload) : {},
    once: Boolean(overrides.once),
  };
}

export function normaliseSolWorldComponents(components) {
  return Array.isArray(components)
    ? components.filter(entry => entry && typeof entry === 'object').map(entry => createSolWorldComponent(entry.type, entry))
    : [];
}

export function createSolWorldDefinition(overrides = {}) {
  return {
    format: SOL_WORLD_COMPONENT_FORMAT,
    version: SOL_WORLD_COMPONENT_VERSION,
    defaultInteractionRange: Math.max(.1, finite(overrides.defaultInteractionRange, 2.5)),
    tags: strings(overrides.tags),
  };
}

const presetComponent = (type, overrides) => Object.freeze(createSolWorldComponent(type, overrides));

export function applySolHingeMotionPreset(component, presetId = 'custom') {
  if (!component || component.type !== 'hinge') return component;
  const resolved = SOL_HINGE_MOTION_PRESETS[presetId] ? presetId : 'custom';
  const preset = SOL_HINGE_MOTION_PRESETS[resolved];
  component.motionPreset = resolved;
  if (resolved === 'custom') return component;
  component.axis = [...preset.axis];
  component.closedAngle = 0;
  component.openAngle = preset.openAngle;
  component.secondaryAxis = [...(preset.secondaryAxis || [0, 0, 1])];
  component.secondaryClosedAngle = 0;
  component.secondaryOpenAngle = preset.secondaryOpenAngle || 0;
  return component;
}

export const SOL_WORLD_PRESETS = Object.freeze({
  door: Object.freeze({ label: 'Door / hatch', components: Object.freeze([
    presetComponent('interact', { prompt: 'Open / close', targetMode: 'toggle' }),
    presetComponent('hinge', { name: 'Door hinge', motionPreset: 'swing-left', axis: [0, 1, 0], pivot: [-.5, 0, 0], openAngle: Math.PI / 2, duration: .65 }),
  ]) }),
  ramp: Object.freeze({ label: 'Ship ramp', components: Object.freeze([
    presetComponent('interact', { prompt: 'Lower / raise ramp', range: 3.5 }),
    presetComponent('hinge', { name: 'Ramp hinge', motionPreset: 'flip-down', axis: [1, 0, 0], pivot: [0, .5, 0], openAngle: -Math.PI * .42, duration: 1.3 }),
  ]) }),
  'interaction-zone': Object.freeze({ label: 'Interaction zone', components: Object.freeze([
    presetComponent('interaction-zone', { name: 'Interaction zone', size: [3, 2.2, 4], activation: 'inside-or-look', maxLookDistance: 12 }),
  ]) }),
  seat: Object.freeze({ label: 'Seat / cockpit', components: Object.freeze([
    presetComponent('interact', { prompt: 'Sit', range: 2 }),
    presetComponent('seat', { role: 'passenger', controlMode: 'none', exitOffset: [0, 0, 1.2] }),
  ]) }),
  'pilot-seat': Object.freeze({ label: 'Pilot seat', components: Object.freeze([
    presetComponent('interact', { prompt: 'Enter pilot seat', range: 2.4 }),
    presetComponent('seat', { name: 'Pilot seat', role: 'pilot', controlMode: 'vehicle', eyeOffset: [0, .78, 0], exitOffset: [0, 0, 1.35] }),
  ]) }),
  'passenger-seat': Object.freeze({ label: 'Passenger seat', components: Object.freeze([
    presetComponent('interact', { prompt: 'Take passenger seat', range: 2.2 }),
    presetComponent('seat', { name: 'Passenger seat', role: 'passenger', controlMode: 'none', eyeOffset: [0, .72, 0], exitOffset: [0, 0, 1.2] }),
  ]) }),
  'external-entry': Object.freeze({ label: 'External ship entry', components: Object.freeze([
    presetComponent('interact', { prompt: 'Enter ship', range: 2.8, targetMode: 'activate' }),
  ]) }),
  pickup: Object.freeze({ label: 'Equip pickup', components: Object.freeze([
    presetComponent('interact', { prompt: 'Equip', range: 1.8 }),
    presetComponent('equippable', { category: 'weapon', slot: 'hands' }),
  ]) }),
  cupboard: Object.freeze({ label: 'Storage / cupboard', components: Object.freeze([
    presetComponent('interact', { prompt: 'Open storage', range: 2.2 }),
    presetComponent('inventory', { inventoryId: 'cupboard', capacity: 24, categories: ['weapon', 'ammo'] }),
  ]) }),
  loot: Object.freeze({ label: 'Placed loot', components: Object.freeze([
    presetComponent('interact', { prompt: 'Take item', range: 1.8 }),
    presetComponent('item-spawn', { selection: 'random-category', category: 'ammo' }),
  ]) }),
  thruster: Object.freeze({ label: 'Thruster', components: Object.freeze([
    presetComponent('thruster', { axis: [0, 0, -1], input: 'thrust-forward', force: 1000, maxSpeed: 100 }),
  ]) }),
  platform: Object.freeze({ label: 'Moving platform', components: Object.freeze([
    presetComponent('interact', { prompt: 'Start / stop platform' }),
    presetComponent('mover', { mode: 'translate', axis: [0, 1, 0], speed: 1, distance: 3, loop: 'ping-pong', autoStart: false }),
  ]) }),
  switch: Object.freeze({ label: 'Switch / signal', components: Object.freeze([
    presetComponent('interact', { prompt: 'Use switch', targetMode: 'activate' }),
    presetComponent('trigger', { event: 'activate' }),
  ]) }),
});

export function applySolWorldPreset(node, presetId, { replace = false } = {}) {
  const preset = SOL_WORLD_PRESETS[presetId];
  if (!node || !preset) return [];
  const additions = preset.components.map(component => createSolWorldComponent(component.type, { ...component, id: '' }));
  node.components = replace ? additions : [...normaliseSolWorldComponents(node.components), ...additions];
  return additions;
}

function normalisedAxis(value, fallback = [0, 1, 0]) {
  const source = vec3(value, fallback);
  const length = Math.hypot(...source);
  return length > 1e-8 ? source.map(entry => entry / length) : [...fallback];
}

function quaternionFromEuler(rotation) {
  const x = finite(rotation?.[0]), y = finite(rotation?.[1]), z = finite(rotation?.[2]);
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1*c2*c3+c1*s2*s3,
    c1*s2*c3-s1*c2*s3,
    c1*c2*s3+s1*s2*c3,
    c1*c2*c3-s1*s2*s3,
  ];
}

function quaternionFromAxis(axis, angle) {
  const half = angle * .5, sine = Math.sin(half), unit = normalisedAxis(axis);
  return [unit[0] * sine, unit[1] * sine, unit[2] * sine, Math.cos(half)];
}

function multiplyQuaternion(a, b) {
  return [
    a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
    a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
    a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
    a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2],
  ];
}

function rotateByQuaternion(vector, quaternion) {
  const x = vector[0], y = vector[1], z = vector[2];
  const qx = quaternion[0], qy = quaternion[1], qz = quaternion[2], qw = quaternion[3];
  const ix = qw*x+qy*z-qz*y, iy = qw*y+qz*x-qx*z, iz = qw*z+qx*y-qy*x, iw = -qx*x-qy*y-qz*z;
  return [
    ix*qw+iw*-qx+iy*-qz-iz*-qy,
    iy*qw+iw*-qy+iz*-qx-ix*-qz,
    iz*qw+iw*-qz+ix*-qy-iy*-qx,
  ];
}

// Convert a quaternion back to the exact Euler convention used by Three.js
// Object3D.rotation (XYZ).  The previous helper used a different convention:
// even an identity world-pose round trip could therefore rotate an authored
// node.  Near +/-90 degree authored rotations made the error spectacular,
// which is why the two converted Torpedo Bomber plates appeared to "flip up"
// while the rest of the ship mostly survived it.
function quaternionToEuler(quaternion) {
  const x = quaternion[0], y = quaternion[1], z = quaternion[2], w = quaternion[3];
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(clamp(m13, -1, 1));
  if (Math.abs(m13) < .9999999) return [
    Math.atan2(-m23, m33),
    ey,
    Math.atan2(-m12, m11),
  ];
  return [Math.atan2(m32, m22), ey, 0];
}

function ease(value, mode) {
  const progress = clamp(value, 0, 1);
  if (mode === 'linear') return progress;
  if (mode === 'mechanical') return 1 - Math.pow(1 - progress, 3);
  return progress * progress * (3 - 2 * progress);
}

export function applySolWorldPose(transform, pose = {}) {
  const result = {
    position: vec3(transform?.position, [0, 0, 0]),
    rotation: vec3(transform?.rotation, [0, 0, 0]),
    scale: vec3(transform?.scale, [1, 1, 1]),
  };
  // Most SOL nodes do not have a live world motion.  Do not route their authored
  // Euler rotation through quaternion conversion at all: an empty runtime pose
  // must be a literal identity operation, byte-for-byte as far as the transform
  // values are concerned.  This also keeps closed zero-angle hinges perfectly
  // still instead of touching unrelated authored orientation state.
  const hingeAngle = pose?.hinge ? finite(pose.hinge.angle) : 0;
  const hingeSecondaryAngle = pose?.hinge ? finite(pose.hinge.secondaryAngle) : 0;
  const rotationAngle = pose?.rotation ? finite(pose.rotation.angle) : 0;
  const translation = vec3(pose?.translation, [0, 0, 0]);
  const hasHinge = Boolean(pose?.hinge) && (Math.abs(hingeAngle) > 1e-12 || Math.abs(hingeSecondaryAngle) > 1e-12);
  const hasRotation = Boolean(pose?.rotation) && Math.abs(rotationAngle) > 1e-12;
  const hasTranslation = Math.hypot(...translation) > 1e-12;
  if (!hasHinge && !hasRotation && !hasTranslation) return result;

  const baseQuaternion = quaternionFromEuler(result.rotation);
  let finalQuaternion = baseQuaternion;
  if (pose.hinge) {
    const primaryDelta = quaternionFromAxis(pose.hinge.axis, hingeAngle);
    const secondaryDelta = quaternionFromAxis(pose.hinge.secondaryAxis || [0, 0, 1], hingeSecondaryAngle);
    const hingeDelta = Math.abs(hingeSecondaryAngle) > 1e-12
      ? multiplyQuaternion(primaryDelta, secondaryDelta)
      : primaryDelta;
    finalQuaternion = multiplyQuaternion(baseQuaternion, hingeDelta);
    // Hinge pivots are authored in the node's geometry-local coordinates.
    // The SOL transform contract applies scale before rotation (T * R * S),
    // so a pivot must pass through the authored scale before we compensate the
    // node translation. Ignoring scale made large / non-uniform Designer parts
    // orbit around a completely different point when previewed as a door or
    // ramp; negative scales could make the jump even more dramatic.
    const pivot = vec3(pose.hinge.pivot, [0, 0, 0]);
    const scaledPivot = pivot.map((value, axis) => value * result.scale[axis]);
    const before = rotateByQuaternion(scaledPivot, baseQuaternion);
    const after = rotateByQuaternion(scaledPivot, finalQuaternion);
    result.position = result.position.map((value, axis) => value + before[axis] - after[axis]);
  }
  if (hasRotation) finalQuaternion = multiplyQuaternion(finalQuaternion, quaternionFromAxis(pose.rotation.axis, rotationAngle));
  result.rotation = quaternionToEuler(finalQuaternion);
  const worldTranslation = rotateByQuaternion(translation, baseQuaternion);
  result.position = result.position.map((value, axis) => value + worldTranslation[axis]);
  return result;
}

export function validateSolWorldComponents(document) {
  const errors = [], warnings = [], nodeIds = new Set((document?.nodes || []).map(node => node.id));
  for (const node of document?.nodes || []) {
    const componentIds = new Set();
    const socketIds = new Set((node.sockets || []).map(socket => socket.id));
    for (const component of normaliseSolWorldComponents(node.components)) {
      if (componentIds.has(component.id)) errors.push(node.name + ' has duplicate component id ' + component.id + '.');
      componentIds.add(component.id);
      for (const targetId of component.targetNodeIds || []) if (!nodeIds.has(targetId)) warnings.push(node.name + ' targets missing object ' + targetId + '.');
      if (['hinge', 'slider', 'thruster', 'mover'].includes(component.type) && Math.hypot(...component.axis) < 1e-8) errors.push(node.name + ' has a zero-length ' + component.type + ' axis.');
      if (component.type === 'hinge' && component.duration <= 0) errors.push(node.name + ' hinge duration must be positive.');
      if (component.type === 'hinge' && Math.abs(component.secondaryOpenAngle - component.secondaryClosedAngle) > 1e-8 && Math.hypot(...component.secondaryAxis) < 1e-8) errors.push(node.name + ' has a zero-length secondary hinge axis.');
      if (component.type === 'slider' && component.duration <= 0) errors.push(node.name + ' slider duration must be positive.');
      if (component.socketId && !socketIds.has(component.socketId)) warnings.push(node.name + ' component ' + component.name + ' uses missing socket ' + component.socketId + '.');
      if (component.type === 'interaction-zone') {
        const targetNodeId = component.targetNodeId || node.id;
        const targetNode = (document.nodes || []).find(entry => entry.id === targetNodeId);
        if (!targetNode) warnings.push(node.name + ' interaction zone targets missing object ' + targetNodeId + '.');
        else {
          const interactions = normaliseSolWorldComponents(targetNode.components).filter(entry => entry.type === 'interact');
          if (!interactions.length) warnings.push(node.name + ' interaction zone has no Use / interact component to activate on ' + targetNode.name + '.');
          if (component.targetComponentId && !interactions.some(entry => entry.id === component.targetComponentId)) warnings.push(node.name + ' interaction zone targets missing interaction ' + component.targetComponentId + '.');
        }
      }
      if (component.type === 'inventory' && component.items.length > component.capacity) warnings.push(node.name + ' inventory starts above its capacity.');
      if (component.type === 'item-spawn' && component.selection === 'specific' && !component.itemId) warnings.push(node.name + ' has a specific item placement with no item id.');
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

function defaultMotionState(component) {
  if (component.type === 'hinge' || component.type === 'slider') {
    const open = Boolean(component.defaultOpen);
    return { progress: open ? 1 : 0, target: open ? 1 : 0, autoClose: 0, cooldown: 0 };
  }
  if (component.type === 'mover') return { active: Boolean(component.autoStart), phase: 0, direction: 1, cooldown: 0 };
  return { active: false, cooldown: 0, used: false };
}

function componentKey(nodeId, componentId) {
  return nodeId + ':' + componentId;
}

export class SolWorldRuntime {
  constructor(document, { random = Math.random } = {}) {
    this.random = typeof random === 'function' ? random : Math.random;
    this.events = [];
    this.inputs = {};
    this.setDocument(document);
  }

  setDocument(document) {
    this.document = document || { nodes: [] };
    this.nodes = new Map((this.document.nodes || []).map(node => [node.id, node]));
    this.states = new Map();
    for (const node of this.document.nodes || []) {
      node.components = normaliseSolWorldComponents(node.components);
      for (const component of node.components) this.states.set(componentKey(node.id, component.id), defaultMotionState(component));
    }
    this.poseMap = new Map();
    this.lastOutputs = { thrust: [] };
    return this;
  }

  reset() {
    return this.setDocument(this.document);
  }

  stateFor(nodeId, component) {
    const key = componentKey(nodeId, component.id);
    if (!this.states.has(key)) this.states.set(key, defaultMotionState(component));
    return this.states.get(key);
  }

  interactions() {
    const result = [];
    for (const node of this.document.nodes || []) for (const component of node.components || []) {
      if (component.type === 'interact' && component.enabled) result.push({
        nodeId: node.id,
        componentId: component.id,
        prompt: component.prompt,
        input: component.input,
        range: component.range,
        holdDuration: component.holdDuration,
        requiresItem: component.requiresItem,
      });
    }
    return result;
  }

  interactionZones() {
    const result = [];
    for (const node of this.document.nodes || []) for (const component of node.components || []) {
      if (component.type !== 'interaction-zone' || !component.enabled) continue;
      const targetNodeId = component.targetNodeId || node.id;
      const targetNode = this.nodes.get(targetNodeId);
      const available = (targetNode?.components || []).filter(entry => entry.enabled && entry.type === 'interact');
      const target = component.targetComponentId
        ? available.find(entry => entry.id === component.targetComponentId)
        : available[0];
      result.push({
        nodeId: node.id,
        componentId: component.id,
        shape: component.shape,
        center: clone(component.center),
        rotation: clone(component.rotation),
        size: clone(component.size),
        activation: component.activation,
        maxLookDistance: component.maxLookDistance,
        targetNodeId,
        targetComponentId: target?.id || component.targetComponentId || '',
      });
    }
    return result;
  }

  setInput(name, value) {
    this.inputs[String(name || '')] = clamp(value, -1, 1);
  }

  activateMotion(nodeId, mode = 'toggle') {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    let changed = false;
    for (const component of node.components || []) {
      if (!component.enabled) continue;
      const state = this.stateFor(nodeId, component);
      if (component.type === 'hinge' || component.type === 'slider') {
        state.target = mode === 'open' ? 1 : mode === 'close' ? 0 : state.target >= .5 ? 0 : 1;
        state.autoClose = state.target > .5 && component.autoCloseDelay > 0 ? component.autoCloseDelay : 0;
        changed = true;
      } else if (component.type === 'mover') {
        state.active = mode === 'open' || mode === 'activate' ? true : mode === 'close' ? false : !state.active;
        changed = true;
      }
    }
    return changed;
  }

  resolvePlacement(component) {
    if (component.selection === 'specific') return component.itemId || null;
    if (component.selection === 'random-list' && component.itemPool.length) return component.itemPool[Math.floor(this.random() * component.itemPool.length)];
    return component.category ? 'random:' + component.category : null;
  }

  use(nodeId, context = {}, componentId = '') {
    const node = this.nodes.get(nodeId);
    if (!node) return { handled: false, events: [] };
    const interactions = (node.components || []).filter(component => component.enabled && component.type === 'interact' && (!componentId || component.id === componentId));
    if (!interactions.length) return { handled: false, events: [] };
    const interaction = interactions[0], interactionState = this.stateFor(nodeId, interaction);
    if (interactionState.cooldown > 0) return { handled: true, events: [] };
    if (interaction.requiresItem && !(context.items || []).includes(interaction.requiresItem)) {
      const event = { type: 'locked', nodeId, componentId: interaction.id, message: interaction.lockedMessage, requiresItem: interaction.requiresItem };
      this.events.push(event);
      return { handled: true, events: [event] };
    }
    interactionState.cooldown = interaction.cooldown;
    const targetIds = interaction.targetNodeIds.length ? interaction.targetNodeIds : [nodeId];
    const before = this.events.length;
    for (const targetId of targetIds) {
      this.activateMotion(targetId, interaction.targetMode);
      const target = this.nodes.get(targetId);
      for (const component of target?.components || []) {
        if (!component.enabled) continue;
        const state = this.stateFor(targetId, component);
        if (component.type === 'seat') this.events.push({ type: 'seat', nodeId: targetId, role: component.role, socketId: component.socketId, eyeOffset: clone(component.eyeOffset), exitOffset: clone(component.exitOffset), controlMode: component.controlMode, lockView: component.lockView, exitOnUse: component.exitOnUse });
        else if (component.type === 'equippable' && !state.used) {
          this.events.push({ type: 'equip', nodeId: targetId, itemId: component.itemId, category: component.category, slot: component.slot, quantity: component.quantity });
          if (component.removeOnEquip) state.used = true;
        } else if (component.type === 'inventory') {
          if (!Array.isArray(state.stock)) state.stock = component.items.flatMap(placement => {
            if (this.random() > placement.chance) return [];
            const itemId = this.resolvePlacement(placement);
            if (!itemId) return [];
            const low = Math.min(placement.quantityMin, placement.quantityMax), high = Math.max(placement.quantityMin, placement.quantityMax);
            return [{ itemId, category: placement.category, socketId: placement.socketId, quantity: low + Math.floor(this.random() * (high - low + 1)) }];
          });
          this.events.push({ type: 'inventory', nodeId: targetId, inventoryId: component.inventoryId, capacity: component.capacity, categories: clone(component.categories), items: clone(component.items), stock: clone(state.stock) });
        }
        else if (component.type === 'item-spawn') {
          const itemId = this.resolvePlacement(component);
          if (itemId && this.random() <= component.chance) this.events.push({ type: 'spawn-item', nodeId: targetId, itemId, category: component.category, socketId: component.socketId, quantityMin: component.quantityMin, quantityMax: component.quantityMax });
        } else if (component.type === 'trigger' && !(component.once && state.used)) {
          this.events.push({ type: 'trigger', nodeId: targetId, event: component.event, targetNodeIds: clone(component.targetNodeIds), payload: clone(component.payload) });
          state.used = true;
        }
      }
    }
    if (this.events.length === before) this.events.push({ type: 'use', nodeId, prompt: interaction.prompt });
    return { handled: true, events: this.events.slice(before) };
  }

  update(dt, inputs = this.inputs) {
    const step = clamp(dt, 0, .1), pose = new Map(), thrust = [];
    for (const node of this.document.nodes || []) {
      const nodePose = {};
      for (const component of node.components || []) {
        const state = this.stateFor(node.id, component);
        state.cooldown = Math.max(0, finite(state.cooldown) - step);
        if (!component.enabled) continue;
        if (component.type === 'hinge' || component.type === 'slider') {
          if (state.autoClose > 0) {
            state.autoClose = Math.max(0, state.autoClose - step);
            if (state.autoClose === 0) state.target = 0;
          }
          const direction = Math.sign(state.target - state.progress);
          state.progress = clamp(state.progress + direction * step / component.duration, 0, 1);
          const amount = ease(state.progress, component.easing);
          if (component.type === 'hinge') nodePose.hinge = {
            axis: normalisedAxis(component.axis),
            pivot: clone(component.pivot),
            angle: component.closedAngle + (component.openAngle - component.closedAngle) * amount,
            secondaryAxis: normalisedAxis(component.secondaryAxis),
            secondaryAngle: component.secondaryClosedAngle + (component.secondaryOpenAngle - component.secondaryClosedAngle) * amount,
          };
          else {
            const distance = component.closedDistance + (component.openDistance - component.closedDistance) * amount;
            nodePose.translation = normalisedAxis(component.axis).map(value => value * distance);
          }
        } else if (component.type === 'mover') {
          const input = component.input === 'auto' ? (state.active ? 1 : 0) : finite(inputs[component.input]);
          if (input !== 0) state.phase += component.speed * input * state.direction * step;
          const extent = Math.max(.0001, component.distance);
          if (component.loop === 'repeat') state.phase = ((state.phase % extent) + extent) % extent;
          else if (component.loop === 'ping-pong' && Math.abs(state.phase) >= extent) {
            state.phase = Math.sign(state.phase || 1) * extent;
            state.direction *= -1;
          } else if (component.loop === 'once') state.phase = clamp(state.phase, 0, extent);
          if (component.mode === 'rotate') nodePose.rotation = { axis: normalisedAxis(component.axis), angle: state.phase };
          else {
            const offset = normalisedAxis(component.axis).map(value => value * state.phase);
            nodePose.translation = (nodePose.translation || [0, 0, 0]).map((value, axis) => value + offset[axis]);
          }
        } else if (component.type === 'thruster') {
          const input = component.input === 'auto' ? 1 : finite(inputs[component.input]);
          if (input !== 0) thrust.push({ nodeId: node.id, componentId: component.id, axis: normalisedAxis(component.axis), force: component.force * input * (component.reverse ? -1 : 1), maxSpeed: component.maxSpeed, response: component.response, reverse: component.reverse });
        }
      }
      if (Object.keys(nodePose).length) pose.set(node.id, nodePose);
    }
    this.poseMap = pose;
    this.lastOutputs = { thrust };
    return { pose, thrust, events: this.drainEvents() };
  }

  pose() {
    return this.poseMap;
  }

  drainEvents() {
    const events = this.events.splice(0);
    return events;
  }
}
