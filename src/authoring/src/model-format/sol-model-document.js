import { normaliseSolMeshGeometry } from './sol-custom-mesh.js?v=1.3.0';
import { normalizeShapeRecipe } from './sol-shape-profile.js?v=1.1.0';
import { normalizeShipHardpoint, normalizeShipWeapon, validateShipArmament } from '../ships/ship-weapons.js?v=1.0.0';
import { createSolPresentationProfile } from './sol-presentation-profile.js?v=1.0.0';
import {
  createSolWorldDefinition,
  normaliseSolWorldComponents,
  validateSolWorldComponents,
} from './sol-world-components.js?v=1.5.0';

export const SOL_MODEL_FORMAT = 'sol-model';
export const SOL_MODEL_VERSION = 1;
export const SOL_MODEL_EXTENSION = '.solmodel.json';
// v2 deliberately isolates the homogeneous registry pipeline from stale v1
// browser captures, which previously replaced the player/gun without exposing
// that override anywhere in the editor.
export const SOL_MODEL_DRAFT_KEY = 'sol-model-designer:draft:v2';
export const SOL_MODEL_PUBLISH_PREFIX = 'sol-model-designer:published:v2:';

export const SOL_ACTIONS = Object.freeze([
  'idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'aim', 'fire',
  'reload', 'interact', 'ride', 'zeroGIdle', 'zeroGMove', 'custom',
]);

export const SOL_SURFACE_PRESETS = Object.freeze({
  habitat: { name: 'Habitat deck', staticFriction: .82, dynamicFriction: .68, restitution: .05, linearDrag: .08, angularDrag: .16, gravityScale: 1, traction: .92, locomotion: 'ground' },
  metal: { name: 'Metal deck', staticFriction: .62, dynamicFriction: .48, restitution: .12, linearDrag: .04, angularDrag: .10, gravityScale: 1, traction: .72, locomotion: 'ground' },
  ice: { name: 'Ice / damaged coolant deck', staticFriction: .10, dynamicFriction: .045, restitution: .04, linearDrag: .006, angularDrag: .012, gravityScale: 1, traction: .13, locomotion: 'ground' },
  magnetic: { name: 'Magnetic EVA deck', staticFriction: .94, dynamicFriction: .80, restitution: .01, linearDrag: .03, angularDrag: .14, gravityScale: 0, traction: 1, locomotion: 'magnetic' },
  zeroG: { name: 'Open space', staticFriction: 0, dynamicFriction: 0, restitution: 0, linearDrag: .004, angularDrag: .008, gravityScale: 0, traction: 0, locomotion: 'zero-g' },
});

let idCounter = 0;

export function solId(prefix = 'item') {
  idCounter += 1;
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8)
    || `${Date.now().toString(36)}${idCounter.toString(36)}`;
  return `${String(prefix).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'item'}-${random}`;
}

export function deepClone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vec(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return fallback.map((entry, index) => finite(source[index], entry));
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

export function createSolMaterial(overrides = {}) {
  return {
    id: text(overrides.id, solId('material')),
    name: text(overrides.name, 'Material'),
    color: vec(overrides.color, [.18, .22, .25]),
    emissive: vec(overrides.emissive, [0, 0, 0]),
    roughness: Math.max(0, Math.min(1, finite(overrides.roughness, .62))),
    metalness: Math.max(0, Math.min(1, finite(overrides.metalness, .12))),
    opacity: Math.max(0, Math.min(1, finite(overrides.opacity, 1))),
    texture: text(overrides.texture, ''),
    textureRepeat: vec(overrides.textureRepeat, [1, 1, 1]).slice(0, 2),
    doubleSided: Boolean(overrides.doubleSided),
    native: overrides.native && typeof overrides.native === 'object' ? deepClone(overrides.native) : null,
  };
}

export function createSolSurface(overrides = {}) {
  const preset = SOL_SURFACE_PRESETS[overrides.preset] || SOL_SURFACE_PRESETS.habitat;
  return {
    id: text(overrides.id, solId('surface')),
    name: text(overrides.name, preset.name),
    staticFriction: Math.max(0, finite(overrides.staticFriction, preset.staticFriction)),
    dynamicFriction: Math.max(0, finite(overrides.dynamicFriction, preset.dynamicFriction)),
    restitution: Math.max(0, Math.min(1, finite(overrides.restitution, preset.restitution))),
    linearDrag: Math.max(0, finite(overrides.linearDrag, preset.linearDrag)),
    angularDrag: Math.max(0, finite(overrides.angularDrag, preset.angularDrag)),
    gravityScale: finite(overrides.gravityScale, preset.gravityScale),
    traction: Math.max(0, Math.min(1, finite(overrides.traction, preset.traction))),
    locomotion: ['ground', 'magnetic', 'zero-g'].includes(overrides.locomotion)
      ? overrides.locomotion : preset.locomotion,
  };
}

/** Absent ownership deliberately preserves pre-property SOL compatibility. */
export function normaliseSolNodeCollision(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.enabled !== 'boolean' || (input.mode !== undefined && input.mode !== 'mesh')) {
    throw new TypeError('Node collision must specify enabled true/false and mesh mode.');
  }
  return { enabled: input.enabled, mode: 'mesh' };
}

export function createSolNode(overrides = {}) {
  const type = ['group', 'box', 'sphere', 'capsule', 'cylinder', 'plate', 'taper', 'mesh'].includes(overrides.type)
    ? overrides.type : 'box';
  const geometry = type === 'mesh'
    ? normaliseSolMeshGeometry(overrides.geometry)
    : overrides.geometry ? deepClone(overrides.geometry) : {};
  const collision = normaliseSolNodeCollision(overrides.collision);
  if (overrides.shapeProfile !== undefined && type !== 'mesh') throw new TypeError('Only a mesh can own a Shape Studio profile.');
  return {
    id: text(overrides.id, solId(type)),
    name: text(overrides.name, type[0].toUpperCase() + type.slice(1)),
    parentId: overrides.parentId ? String(overrides.parentId) : null,
    type,
    transform: {
      position: vec(overrides.transform?.position, [0, 0, 0]),
      rotation: vec(overrides.transform?.rotation, [0, 0, 0]),
      scale: vec(overrides.transform?.scale, [1, 1, 1]),
    },
    materialId: overrides.materialId ? String(overrides.materialId) : null,
    surfaceId: overrides.surfaceId ? String(overrides.surfaceId) : null,
    visible: overrides.visible !== false,
    geometry,
    // Baked geometry owns rendering; the recipe remains optional authoring data.
    ...(overrides.shapeProfile !== undefined ? { shapeProfile: normalizeShapeRecipe(overrides.shapeProfile) } : {}),
    ...(collision !== undefined ? { collision } : {}),
    ...(overrides.shipHardpoint !== undefined ? { shipHardpoint: normalizeShipHardpoint(overrides.shipHardpoint) } : {}),
    ...(overrides.shipWeapon !== undefined ? { shipWeapon: normalizeShipWeapon(overrides.shipWeapon) } : {}),
    joint: {
      kind: ['fixed', 'hinge', 'ball'].includes(overrides.joint?.kind) ? overrides.joint.kind : 'fixed',
      axis: vec(overrides.joint?.axis, [1, 0, 0]),
      limits: {
        min: finite(overrides.joint?.limits?.min, -Math.PI),
        max: finite(overrides.joint?.limits?.max, Math.PI),
      },
    },
    tags: Array.isArray(overrides.tags) ? overrides.tags.map(String) : [],
    sockets: Array.isArray(overrides.sockets) ? deepClone(overrides.sockets) : [],
    components: normaliseSolWorldComponents(overrides.components),
  };
}

export function createSolClip(overrides = {}) {
  return {
    id: text(overrides.id, solId('clip')),
    name: text(overrides.name, 'Idle'),
    duration: Math.max(.01, finite(overrides.duration, 1)),
    loop: overrides.loop !== false,
    tracks: Array.isArray(overrides.tracks) ? deepClone(overrides.tracks) : [],
    events: Array.isArray(overrides.events) ? deepClone(overrides.events) : [],
  };
}

export function createActionMap(overrides = {}) {
  return {
    id: text(overrides.id, solId('action')),
    action: SOL_ACTIONS.includes(overrides.action) ? overrides.action : 'idle',
    clipId: overrides.clipId ? String(overrides.clipId) : null,
    blendIn: Math.max(0, finite(overrides.blendIn, .16)),
    blendOut: Math.max(0, finite(overrides.blendOut, .20)),
    speedScale: Math.max(.01, finite(overrides.speedScale, 1)),
    conditions: {
      surfaceMode: ['any', 'ground', 'magnetic', 'zero-g'].includes(overrides.conditions?.surfaceMode)
        ? overrides.conditions.surfaceMode : 'any',
      minSpeed: Math.max(0, finite(overrides.conditions?.minSpeed, 0)),
      maxSpeed: Math.max(0, finite(overrides.conditions?.maxSpeed, 1000)),
      weapon: text(overrides.conditions?.weapon, 'any'),
    },
  };
}

export function createSolModelDocument(overrides = {}) {
  const material = createSolMaterial({ id: 'material-default', name: 'Graphite', color: [.12, .15, .18], roughness: .66, metalness: .18 });
  const surface = createSolSurface({ id: 'surface-default', preset: 'habitat' });
  const idle = createSolClip({ id: 'clip-idle', name: 'Idle', duration: 1.6 });
  const document = {
    format: SOL_MODEL_FORMAT,
    version: SOL_MODEL_VERSION,
    meta: {
      id: text(overrides.meta?.id, solId('model')),
      name: text(overrides.meta?.name, 'Untitled SOL model'),
      kind: ['character', 'weapon', 'ship', 'prop'].includes(overrides.meta?.kind) ? overrides.meta.kind : 'character',
      description: text(overrides.meta?.description, ''),
      registryId: text(overrides.meta?.registryId, ''),
      registryRevision: text(overrides.meta?.registryRevision, ''),
      runtimeSlot: text(overrides.meta?.runtimeSlot, ''),
      source: text(overrides.meta?.source, overrides.meta?.registryId ? 'registry' : 'document'),
      parameters: overrides.meta?.parameters && typeof overrides.meta.parameters === 'object' ? deepClone(overrides.meta.parameters) : {},
      units: 'metres',
      upAxis: 'Y',
      forwardAxis: '-Z',
      updatedAt: new Date().toISOString(),
    },
    materials: Array.isArray(overrides.materials) ? overrides.materials.map(createSolMaterial) : [material],
    surfaces: Array.isArray(overrides.surfaces) ? overrides.surfaces.map(createSolSurface) : [surface],
    nodes: Array.isArray(overrides.nodes) ? overrides.nodes.map(createSolNode) : [],
    animations: Array.isArray(overrides.animations) ? overrides.animations.map(createSolClip) : [idle],
    actionMap: Array.isArray(overrides.actionMap) ? overrides.actionMap.map(createActionMap) : [createActionMap({ action: 'idle', clipId: idle.id })],
    // Presentation is deliberately separate from authored node transforms. It
    // is applied once at the finished hierarchy root by both Designer and
    // Explorer, so tuning a viewmodel can never pull its children apart.
    presentation: createSolPresentationProfile(overrides.presentation),
    physics: {
      mass: Math.max(.001, finite(overrides.physics?.mass, overrides.meta?.kind === 'weapon' ? 4.2 : 82)),
      centreOfMass: vec(overrides.physics?.centreOfMass, [0, 1, 0]),
      defaultSurfaceId: text(overrides.physics?.defaultSurfaceId, surface.id),
      collisionMode: ['solid', 'none'].includes(overrides.physics?.collisionMode) ? overrides.physics.collisionMode : 'solid',
      walkable: overrides.physics?.walkable !== false,
      colliders: Array.isArray(overrides.physics?.colliders) ? deepClone(overrides.physics.colliders) : [],
    },
    world: createSolWorldDefinition(overrides.world),
    lods: Array.isArray(overrides.lods) ? deepClone(overrides.lods) : [],
  };
  return document;
}

function bipedNodes(materialId = 'material-default', surfaceId = 'surface-default') {
  const nodes = [];
  const add = (name, type, parentId, position, size, tags = []) => {
    const node = createSolNode({ id: solId(name), name, type, parentId, materialId, surfaceId, transform: { position }, geometry: { size }, tags });
    nodes.push(node);
    return node.id;
  };
  const root = add('Root', 'group', null, [0, 0, 0], [1, 1, 1], ['root']);
  const hips = add('Hips', 'sphere', root, [0, 1.02, 0], [.36, .25, .27], ['pelvis', 'joint']);
  const spine = add('Spine', 'capsule', hips, [0, .30, 0], [.34, .34, .24], ['spine', 'joint']);
  const chest = add('Chest', 'sphere', spine, [0, .35, 0], [.45, .34, .28], ['chest', 'joint']);
  const neck = add('Neck', 'cylinder', chest, [0, .32, 0], [.13, .12, .13], ['neck', 'joint']);
  add('Head', 'sphere', neck, [0, .27, 0], [.25, .30, .24], ['head', 'joint']);
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'Left' : 'Right';
    const shoulder = add(`${label} shoulder`, 'sphere', chest, [side * .40, .16, 0], [.17, .18, .17], ['shoulder', 'joint']);
    const upperArm = add(`${label} upper arm`, 'capsule', shoulder, [side * .05, -.25, 0], [.13, .27, .13], ['upper-arm', 'joint']);
    const forearm = add(`${label} forearm`, 'capsule', upperArm, [0, -.42, 0], [.105, .25, .10], ['forearm', 'joint']);
    add(`${label} hand`, 'sphere', forearm, [0, -.30, .035], [.105, .13, .09], ['hand', 'socket']);
    const thigh = add(`${label} thigh`, 'capsule', hips, [side * .15, -.32, 0], [.16, .34, .15], ['thigh', 'joint']);
    const shin = add(`${label} shin`, 'capsule', thigh, [0, -.58, 0], [.12, .31, .11], ['shin', 'joint']);
    add(`${label} boot`, 'plate', shin, [0, -.38, .11], [.17, .11, .29], ['foot', 'contact']);
  }
  return nodes;
}

export function createSolTemplate(kind = 'biped') {
  if (kind === 'empty') return createSolModelDocument({ meta: { name: 'Empty model', kind: 'prop' } });
  if (kind === 'weapon') {
    const document = createSolModelDocument({ meta: { name: 'SOL weapon', kind: 'weapon' }, physics: { mass: 4.2, centreOfMass: [0, 0, 0] } });
    document.nodes = [
      createSolNode({ id: 'weapon-root', name: 'Weapon root', type: 'group' }),
      createSolNode({ name: 'Receiver', type: 'box', parentId: 'weapon-root', materialId: 'material-default', transform: { position: [0, 0, 0] }, geometry: { size: [.12, .15, .40] }, tags: ['receiver'] }),
      createSolNode({ name: 'Barrel', type: 'cylinder', parentId: 'weapon-root', materialId: 'material-default', transform: { position: [0, .01, -.48], rotation: [Math.PI / 2, 0, 0] }, geometry: { size: [.04, .45, .04] }, tags: ['barrel'], sockets: [{ id: 'muzzle', name: 'Muzzle', position: [0, 0, -.24], rotation: [0, 0, 0] }] }),
      createSolNode({ name: 'Grip', type: 'capsule', parentId: 'weapon-root', materialId: 'material-default', transform: { position: [0, -.23, .04], rotation: [0, 0, -.30] }, geometry: { size: [.07, .25, .07] }, tags: ['grip'], sockets: [{ id: 'primary-hand', name: 'Primary hand', position: [0, 0, 0], rotation: [0, 0, 0] }] }),
    ];
    return document;
  }
  const document = createSolModelDocument({ meta: { name: kind === 'pilot' ? 'Armoured pilot rig' : 'SOL biped', kind: 'character' } });
  document.nodes = bipedNodes();
  document.animations.push(createSolClip({ id: 'clip-walk', name: 'Walk', duration: 1 }));
  document.actionMap.push(createActionMap({ action: 'walk', clipId: 'clip-walk', conditions: { surfaceMode: 'ground', minSpeed: .1, maxSpeed: 3.6 } }));
  return document;
}

export function normaliseSolModelDocument(input) {
  if (!input || typeof input !== 'object') throw new TypeError('SOL model must be a JSON object.');
  if (input.format !== SOL_MODEL_FORMAT) throw new TypeError(`Unsupported model format: ${input.format || 'missing'}.`);
  if (Number(input.version) > SOL_MODEL_VERSION) throw new TypeError(`This editor supports SOL model version ${SOL_MODEL_VERSION}, not ${input.version}.`);
  const document = createSolModelDocument(input);
  document.meta.updatedAt = text(input.meta?.updatedAt, new Date().toISOString());
  return document;
}

export function validateSolModelDocument(document) {
  const errors = [];
  const warnings = [];
  if (document?.format !== SOL_MODEL_FORMAT) errors.push('Document format must be sol-model.');
  if (Number(document?.version) !== SOL_MODEL_VERSION) errors.push(`Document version must be ${SOL_MODEL_VERSION}.`);
  if (!document?.meta?.name) errors.push('Model needs a name.');
  if (document?.meta?.registryId && !document?.meta?.runtimeSlot) errors.push('Registry models need a runtime slot.');
  const ids = new Set();
  const collect = (items, label) => {
    for (const item of items || []) {
      if (!item?.id) errors.push(`${label} is missing an id.`);
      else if (ids.has(item.id)) errors.push(`Duplicate id: ${item.id}.`);
      else ids.add(item.id);
    }
  };
  collect(document?.materials, 'Material');
  collect(document?.surfaces, 'Surface');
  collect(document?.nodes, 'Node');
  collect(document?.animations, 'Animation');
  const nodeIds = new Set((document?.nodes || []).map(node => node.id));
  const materialIds = new Set((document?.materials || []).map(material => material.id));
  const surfaceIds = new Set((document?.surfaces || []).map(surface => surface.id));
  const clipIds = new Set((document?.animations || []).map(clip => clip.id));
  for (const node of document?.nodes || []) {
    if (node.shapeProfile !== undefined) {
      try {
        if (node.type !== 'mesh') throw new TypeError('Only a mesh can own a profile.');
        normalizeShapeRecipe(node.shapeProfile);
      } catch (error) { errors.push(`${node.name} has an invalid Shape Studio profile: ${error.message}`); }
    }
    if (node.collision !== undefined && (!node.collision || typeof node.collision !== 'object'
      || Array.isArray(node.collision) || typeof node.collision.enabled !== 'boolean' || node.collision.mode !== 'mesh')) {
      errors.push(`${node.name} collision must specify enabled true/false and mesh mode.`);
    }
    if (node.parentId && !nodeIds.has(node.parentId)) errors.push(`${node.name} has a missing parent.`);
    if (node.parentId === node.id) errors.push(`${node.name} cannot parent itself.`);
    if (node.materialId && !materialIds.has(node.materialId)) warnings.push(`${node.name} uses a missing material.`);
    if (node.surfaceId && !surfaceIds.has(node.surfaceId)) warnings.push(`${node.name} uses a missing surface.`);
    for (const value of [...node.transform.position, ...node.transform.rotation, ...node.transform.scale]) {
      if (!Number.isFinite(Number(value))) errors.push(`${node.name} has a non-finite transform.`);
    }
    if (node.type === 'mesh') {
      const mesh = normaliseSolMeshGeometry(node.geometry);
      if (mesh.vertices.length < 3) errors.push(`${node.name} needs at least three mesh vertices.`);
      if (!mesh.faces.length) errors.push(`${node.name} needs at least one filled face.`);
      mesh.faces.forEach((face, index) => {
        if (face.materialId && !materialIds.has(face.materialId)) warnings.push(`${node.name} face ${index + 1} uses a missing material.`);
        if (face.surfaceId && !surfaceIds.has(face.surfaceId)) warnings.push(`${node.name} face ${index + 1} uses a missing surface.`);
      });
    }
  }
  for (const mapping of document?.actionMap || []) {
    if (mapping.clipId && !clipIds.has(mapping.clipId)) warnings.push(`${mapping.action} maps to a missing animation.`);
  }
  const worldValidation = validateSolWorldComponents(document);
  errors.push(...validateShipArmament(document));
  errors.push(...worldValidation.errors);
  warnings.push(...worldValidation.warnings);
  if (!(document?.nodes || []).length) warnings.push('Model contains no geometry.');
  return { valid: errors.length === 0, errors, warnings };
}

export function serialiseSolModelDocument(document, pretty = true) {
  const copy = deepClone(document);
  copy.meta.updatedAt = new Date().toISOString();
  return JSON.stringify(copy, null, pretty ? 2 : 0);
}

export function safeSolFilename(document) {
  const stem = text(document?.meta?.name, 'sol-model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sol-model';
  return `${stem}${SOL_MODEL_EXTENSION}`;
}
