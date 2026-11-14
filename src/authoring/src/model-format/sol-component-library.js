/** Independent, copied SOL components. No file writes or runtime assignments.
 * A component keeps its source model-space orientation and dimensions. Exact
 * ancestor TRS chains preserve reflected/non-uniform scale and resulting shear;
 * only translation is rebased to the selected object's authored pivot.
 */
import {
  createSolModelDocument, createSolNode, deepClone, safeSolFilename, solId,
  validateSolModelDocument,
} from './sol-model-document.js';
import { qFromXYZ, qRotate } from '../characters/humanoid-motion.js?v=1.0.0';
import { solComponentLibraryHierarchy, solLibraryInstanceRecords, copySolLibraryInstances,
  solLibraryHierarchyCategory } from './sol-library-hierarchy.js?v=1.1.0';

export const SOL_COMPONENT_FORMAT = 'sol-component';
export const SOL_COMPONENT_VERSION = 1;

function checkedNodes(document) {
  const result = validateSolModelDocument(document);
  if (!result.valid) throw new TypeError(result.errors.join(' '));
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  for (const node of nodes.values()) {
    const seen = new Set([node.id]);
    let parent = node.parentId;
    while (parent) {
      if (seen.has(parent)) throw new TypeError('Component hierarchy contains a cycle.');
      if (!nodes.has(parent)) throw new TypeError('Component hierarchy has a missing parent.');
      seen.add(parent); parent = nodes.get(parent).parentId;
    }
  }
  return nodes;
}

export function solComponentNodeIds(document, rootId) {
  const nodes = checkedNodes(document);
  if (!nodes.has(rootId)) throw new TypeError('Select an existing object or group.');
  const included = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes.values()) if (included.has(node.parentId) && !included.has(node.id)) {
      included.add(node.id); changed = true;
    }
  }
  return included;
}

function transformPoint(point, transform) {
  const rotated = qRotate(qFromXYZ(transform.rotation), point.map((v, axis) => v * transform.scale[axis]));
  return rotated.map((v, axis) => v + transform.position[axis]);
}

function authoredPivot(node, nodes) {
  let point = [0, 0, 0], current = node;
  while (current) { point = transformPoint(point, current.transform); current = nodes.get(current.parentId); }
  return point;
}

function warningList() {
  const messages = new Set();
  return { add: message => messages.add(message), values: () => [...messages] };
}

/** Remove outward behavior references without turning an empty target list
 * into the runtime's implicit 'activate myself' behavior. */
function cleanReferences(nodes, allowedIds, warnings) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) for (const component of node.components || []) {
    if (Array.isArray(component.targetNodeIds)) {
      const before = component.targetNodeIds;
      component.targetNodeIds = before.filter(id => allowedIds.has(id));
      if (before.length !== component.targetNodeIds.length) {
        warnings.add(`${node.name}: removed targets outside this component.`);
        if (before.length && !component.targetNodeIds.length) component.enabled = false;
      }
    }
    if (component.targetNodeId && !allowedIds.has(component.targetNodeId)) {
      warnings.add(`${node.name}: disabled an interaction zone targeting an object outside this component.`);
      component.targetNodeId = ''; component.targetComponentId = ''; component.enabled = false;
    }
    if (component.targetComponentId) {
      const target = byId.get(component.targetNodeId || node.id);
      if (!(target?.components || []).some(candidate => candidate.id === component.targetComponentId)) {
        warnings.add(`${node.name}: disabled an interaction zone with an unavailable target behavior.`);
        component.targetComponentId = ''; component.enabled = false;
      }
    }
  }
}

function selectedClips(document, ids, warnings) {
  const clips = [];
  for (const original of document.animations || []) {
    const tracks = (original.tracks || []).filter(track => ids.has(track.nodeId));
    if (!tracks.length) continue;
    const copy = deepClone(original);
    copy.tracks = deepClone(tracks);
    copy.events = (copy.events || []).filter(event => {
      const outside = event.nodeId && !ids.has(event.nodeId);
      if (outside) warnings.add(`${original.name}: omitted an animation event targeting another object.`);
      return !outside;
    });
    clips.push(copy);
  }
  return clips;
}

export function isSolComponentDocument(document) {
  const component = document?.meta?.parameters?.component;
  return Boolean(document?.format === 'sol-model' && document.meta?.kind === 'prop'
    && !document.meta.registryId && !document.meta.runtimeSlot
    && component?.format === SOL_COMPONENT_FORMAT && component.version === SOL_COMPONENT_VERSION
    && document.nodes?.some(node => node.id === component.rootId && node.type === 'group' && !node.parentId));
}

export function safeSolComponentFilename(document) {
  return 'component-' + safeSolFilename(document).replace(/^component-/, '');
}

/** Extract an authored subtree. Source data and the active editing document
 * remain untouched. Context groups carry transforms only, never sibling parts
 * or ancestor behavior, so a saved chair remains an independent object. */
export function extractSolComponent(document, nodeId, { name = '' } = {}) {
  const byId = checkedNodes(document), selected = byId.get(nodeId);
  if (!selected) throw new TypeError('Select an existing object or group to save.');
  const ids = solComponentNodeIds(document, nodeId), warnings = warningList();
  const libraryHierarchy = solComponentLibraryHierarchy(document, nodeId);
  const libraryInstances = solLibraryInstanceRecords(document).filter(record => ids.has(record.rootId));
  for (const warning of validateSolModelDocument(document).warnings) warnings.add('Source warning: ' + warning);
  const sourcePivot = authoredPivot(selected, byId);
  const root = createSolNode({ name: String(name).trim() || selected.name, type: 'group', tags: ['component-root', 'reusable-component'] });
  const ancestors = [];
  let parent = byId.get(selected.parentId);
  while (parent) { ancestors.unshift(parent); parent = byId.get(parent.parentId); }
  let parentId = root.id;
  const contextNodes = ancestors.map((ancestor, index) => {
    const transform = deepClone(ancestor.transform);
    if (index === 0) transform.position = transform.position.map((v, axis) => v - sourcePivot[axis]);
    const context = createSolNode({ name: `${ancestor.name} · transform context`, type: 'group', parentId,
      transform, visible: ancestor.visible, tags: ['component-transform-context'] });
    parentId = context.id;
    return context;
  });
  if (!ancestors.length) {
    const context = createSolNode({ name: 'Source placement · transform context', type: 'group', parentId,
      transform: { position: sourcePivot.map(value => -value) }, tags: ['component-transform-context'] });
    contextNodes.push(context); parentId = context.id;
  }
  const subtree = document.nodes.filter(node => ids.has(node.id)).map(deepClone);
  const extractedRoot = subtree.find(node => node.id === nodeId);
  extractedRoot.parentId = parentId;
  cleanReferences(subtree, ids, warnings);
  if (ancestors.some(node => (node.components || []).length)) warnings.add('Ancestor behaviors are not included; their authored transforms are retained as static context.');
  if ((document.animations || []).some(clip => (clip.tracks || []).some(track => ancestors.some(node => node.id === track.nodeId)))) {
    warnings.add('Ancestor animation is not included; its authored transforms are retained as static context.');
  }
  const materialIds = new Set(), surfaceIds = new Set();
  for (const node of subtree) {
    if (node.materialId) materialIds.add(node.materialId);
    if (node.surfaceId) surfaceIds.add(node.surfaceId);
    for (const face of node.geometry?.faces || []) {
      if (face.materialId) materialIds.add(face.materialId);
      if (face.surfaceId) surfaceIds.add(face.surfaceId);
    }
  }
  if (document.physics?.defaultSurfaceId) surfaceIds.add(document.physics.defaultSurfaceId);
  const animations = selectedClips(document, ids, warnings), clipIds = new Set(animations.map(clip => clip.id));
  const colliders = (document.physics?.colliders || []).filter(collider => {
    const include = collider.nodeId && ids.has(collider.nodeId);
    if (!include) warnings.add('Excluded collider descriptors without ownership inside the selected component.');
    return include;
  }).map(deepClone);
  if (document.lods?.length) warnings.add('Whole-model LOD definitions are not included in an independent component.');
  const component = createSolModelDocument({
    meta: { name: root.name, kind: 'prop', source: 'component-library',
      description: `Reusable component extracted from ${document.meta.name}.`,
      parameters: { component: { format: SOL_COMPONENT_FORMAT, version: SOL_COMPONENT_VERSION,
        rootId: root.id, sourceModelId: document.meta.id, sourceModelName: document.meta.name,
        sourceNodeId: selected.id, sourcePivot,
        sourceMountTransforms: [...ancestors, selected].map(node => deepClone(node.transform)),
        nodeCount: subtree.length, warnings: warnings.values(),
        ...(libraryHierarchy ? { libraryHierarchy, category: solLibraryHierarchyCategory(libraryHierarchy) } : {}) },
        ...(libraryInstances.length ? { componentLibrary: { version: 1, instances: libraryInstances } } : {}) } },
    nodes: [], materials: [], surfaces: [], animations: [], actionMap: [],
    physics: { mass: 1, centreOfMass: [0, 0, 0], defaultSurfaceId: document.physics?.defaultSurfaceId,
      collisionMode: document.physics?.collisionMode, walkable: document.physics?.walkable, colliders },
    world: deepClone(document.world),
  });
  // Keep authored material fields, face attributes, sockets, and complete local
  // node records; normalising these again would erase extension metadata.
  component.nodes = [root, ...contextNodes, ...subtree];
  component.materials = document.materials.filter(material => materialIds.has(material.id)).map(deepClone);
  component.surfaces = document.surfaces.filter(surface => surfaceIds.has(surface.id)).map(deepClone);
  component.animations = animations;
  component.actionMap = (document.actionMap || []).filter(mapping => clipIds.has(mapping.clipId)).map(deepClone);
  return component;
}

function allDocumentIds(document) {
  return new Set([
    ...['nodes', 'materials', 'surfaces', 'animations', 'actionMap'].flatMap(key => (document[key] || []).map(entry => entry.id)),
    ...(document.nodes || []).flatMap(node => [...(node.components || []), ...(node.sockets || [])].map(entry => entry.id)),
    ...(document.physics?.colliders || []).map(entry => entry.id),
  ].filter(Boolean));
}

function newIdFactory(used) {
  return prefix => { let id; do { id = solId(prefix); } while (used.has(id)); used.add(id); return id; };
}

function remapComponents(node, oldNodeId, nodeIds, componentIds, warnings) {
  for (const component of node.components || []) {
    const targetNode = component.targetNodeId || oldNodeId;
    if (component.targetComponentId) {
      const mapped = componentIds.get(`${targetNode}:${component.targetComponentId}`);
      if (!mapped) {
        warnings.add(`${node.name}: disabled an interaction zone whose mounted behavior is no longer available.`);
        component.enabled = false;
      }
      component.targetComponentId = mapped || '';
    }
    component.id = componentIds.get(`${oldNodeId}:${component.id}`);
    if (component.targetNodeId) {
      const mapped = nodeIds.get(component.targetNodeId);
      if (!mapped) {
        warnings.add(`${node.name}: disabled a reference outside the saved component.`);
        component.enabled = false;
      }
      component.targetNodeId = mapped || '';
    }
    if (Array.isArray(component.targetNodeIds)) {
      const previousCount = component.targetNodeIds.length;
      component.targetNodeIds = component.targetNodeIds.map(id => nodeIds.get(id)).filter(Boolean);
      if (previousCount !== component.targetNodeIds.length) {
        warnings.add(`${node.name}: removed targets outside the saved component.`);
        if (!component.targetNodeIds.length) component.enabled = false;
      }
    }
  }
}

/** Copy a library component into a document, optionally replacing a selected
 * subtree. The target placement root keeps its stable identity and authoring
 * controls. Removed descendant references are pruned explicitly and reported.
 * The caller applies the returned document through its ordinary undo mutation.
 */
export function insertSolComponent(target, component, { parentId = null, transform = null, replaceNodeId = null } = {}) {
  const targetNodes = checkedNodes(target), sourceNodes = checkedNodes(component);
  if (!isSolComponentDocument(component)) throw new TypeError('Choose a saved SOL component.');
  if (parentId && !targetNodes.has(parentId)) throw new TypeError('The insertion parent no longer exists.');
  const replaced = replaceNodeId ? targetNodes.get(replaceNodeId) : null;
  if (replaceNodeId && !replaced) throw new TypeError('The replacement object no longer exists.');
  const sourceRootId = component.meta.parameters.component.rootId;
  const sourceIds = solComponentNodeIds(component, sourceRootId);
  if (sourceIds.size !== sourceNodes.size) throw new TypeError('All component objects must belong to its component root group.');
  const document = deepClone(target), warnings = warningList();
  for (const warning of validateSolModelDocument(component).warnings) warnings.add('Component warning: ' + warning);
  for (const warning of component.meta.parameters.component.warnings || []) warnings.add(warning);
  const allocateId = newIdFactory(allDocumentIds(target));
  const rootId = replaced ? replaced.id : allocateId('component-instance');
  const nodeIds = new Map(component.nodes.map(node => [node.id, allocateId(node.type || 'node')]));
  const materialIds = new Map(component.materials.map(material => [material.id, allocateId('material')]));
  const surfaceIds = new Map(component.surfaces.map(surface => [surface.id, allocateId('surface')]));
  const componentIds = new Map(component.nodes.flatMap(node => (node.components || []).map(entry =>
    [`${node.id}:${entry.id}`, allocateId(entry.type || 'behavior')])));
  const selectedSourceId = component.meta.parameters.component.sourceNodeId;
  const sameSourceMount = Boolean(replaced && component.meta.parameters.component.sourceModelId === target.meta.id
    && selectedSourceId === replaced.id);
  const clipIds = new Map(component.animations.map(clip => [clip.id,
    sameSourceMount && target.animations.some(existing => existing.id === clip.id) ? clip.id : allocateId('clip')]));
  const behaviorNodeIds = new Map(nodeIds);
  if (sameSourceMount) {
    behaviorNodeIds.set(selectedSourceId, rootId);
    for (const behavior of sourceNodes.get(selectedSourceId)?.components || []) {
      componentIds.set(`${selectedSourceId}:${behavior.id}`, (replaced.components || []).some(entry => entry.id === behavior.id) ? behavior.id : '');
    }
    warnings.add('Same-source replacement keeps the mount sockets and behaviors; prototype root behaviors are not duplicated.');
  }
  const removedIds = replaced ? solComponentNodeIds(target, replaced.id) : new Set();
  const oldIndex = replaced ? document.nodes.findIndex(node => node.id === replaced.id) : document.nodes.length;
  document.nodes = document.nodes.filter(node => !removedIds.has(node.id));
  if (replaced) {
    const removedChildren = new Set([...removedIds].filter(id => id !== replaced.id));
    const retainedIds = new Set(target.nodes.filter(node => !removedChildren.has(node.id)).map(node => node.id));
    cleanReferences(document.nodes, retainedIds, warnings);
    for (const clip of document.animations) {
      const before = clip.tracks?.length || 0;
      clip.tracks = (clip.tracks || []).filter(track => !removedChildren.has(track.nodeId));
      if (before !== clip.tracks.length) warnings.add(`${clip.name}: removed animation tracks for replaced descendants.`);
      clip.events = (clip.events || []).filter(event => !removedChildren.has(event.nodeId));
    }
    const previousColliders = document.physics.colliders || [];
    document.physics.colliders = previousColliders.filter(collider => !removedIds.has(collider.nodeId));
    if (previousColliders.length !== document.physics.colliders.length) warnings.add('Removed collider descriptors owned by the replaced subtree.');
    for (const lod of document.lods || []) if (Array.isArray(lod.nodeIds)) {
      const count = lod.nodeIds.length;
      lod.nodeIds = lod.nodeIds.filter(id => !removedChildren.has(id));
      if (lod.nodeIds.length !== count) warnings.add('Removed replaced descendant references from a model LOD.');
    }
  }
  const placement = replaced ? deepClone(replaced) : createSolNode({ id: rootId, name: component.meta.name, type: 'group' });
  placement.type = 'group'; placement.geometry = {};
  placement.parentId = replaced ? replaced.parentId : parentId;
  if (!replaced && transform) placement.transform = deepClone(transform);
  placement.tags = [...new Set([...(placement.tags || []), 'component-instance', `component-source:${component.meta.id}`])];
  let definitionParentId = rootId;
  const mountContexts = [];
  if (replaced) {
    const transforms = component.meta.parameters.component.sourceMountTransforms;
    if (!Array.isArray(transforms)) throw new TypeError('This component lacks its authored mount context. Save it again before replacing a mounted group.');
    // The saved view includes the original parent and selected-object linear
    // transforms. A replacement uses the target object's mounting axes. Keep
    // that mount unchanged and cancel the captured basis through exact inverse
    // groups: (R*S)^-1 = S^-1 * Rz^-1 * Ry^-1 * Rx^-1. No matrix decomposition.
    for (const sourceTransform of [...transforms].reverse()) {
      if (!sourceTransform || !['position', 'rotation', 'scale'].every(property => Array.isArray(sourceTransform[property])
        && sourceTransform[property].length === 3 && sourceTransform[property].every(Number.isFinite))) {
        throw new TypeError('Component mount context must contain finite authored TRS transforms.');
      }
      if (sourceTransform.scale.some(value => !Number.isFinite(value) || Math.abs(value) < 1e-12)) {
        throw new TypeError('A component captured under zero scale cannot replace a mounted group. Insert a copy or edit its source scale first.');
      }
      const inverseSteps = [
        { scale: sourceTransform.scale.map(value => 1 / value) },
        { rotation: [0, 0, -sourceTransform.rotation[2]] },
        { rotation: [0, -sourceTransform.rotation[1], 0] },
        { rotation: [-sourceTransform.rotation[0], 0, 0] },
      ];
      for (const step of inverseSteps) {
        if (step.scale?.every(value => value === 1) || step.rotation?.every(value => value === 0)) continue;
        const context = createSolNode({ id: allocateId('mount-context'), name: 'Component mount · inverse context',
          type: 'group', parentId: definitionParentId, transform: step, tags: ['component-mount-context'] });
        mountContexts.push(context); definitionParentId = context.id;
      }
    }
  }
  const copied = component.nodes.map(original => {
    const copy = deepClone(original);
    copy.id = nodeIds.get(original.id); copy.parentId = nodeIds.get(original.parentId) || null;
    copy.materialId = materialIds.get(original.materialId) || null;
    copy.surfaceId = surfaceIds.get(original.surfaceId) || null;
    for (const face of copy.geometry?.faces || []) {
      if (face.materialId) face.materialId = materialIds.get(face.materialId) || null;
      if (face.surfaceId) face.surfaceId = surfaceIds.get(face.surfaceId) || null;
    }
    remapComponents(copy, original.id, behaviorNodeIds, componentIds, warnings);
    if (sameSourceMount && original.id === selectedSourceId) {
      copy.components = []; copy.sockets = [];
      copy.joint = { kind: 'fixed', axis: [1, 0, 0], limits: { min: -Math.PI, max: Math.PI } };
      copy.tags = [...new Set([...copy.tags, 'component-behaviors-owned-by-mount'])];
    }
    if (original.id === sourceRootId) {
      copy.parentId = definitionParentId;
    }
    return copy;
  });
  document.nodes.splice(oldIndex, 0, placement, ...mountContexts, ...copied);
  cleanReferences(document.nodes, new Set(document.nodes.map(node => node.id)), warnings);
  document.materials.push(...component.materials.map(original => ({ ...deepClone(original), id: materialIds.get(original.id) })));
  document.surfaces.push(...component.surfaces.map(original => ({ ...deepClone(original), id: surfaceIds.get(original.id) })));
  for (const original of component.animations) {
    const clip = deepClone(original); clip.id = clipIds.get(original.id);
    // A same-source mount keeps root motion ownership too. Both retained and
    // newly copied clips address that stable root, never a second moving root.
    clip.tracks = (clip.tracks || []).map(track => ({ ...track, nodeId: behaviorNodeIds.get(track.nodeId) }));
    clip.events = (clip.events || []).map(event => event.nodeId ? { ...event, nodeId: behaviorNodeIds.get(event.nodeId) } : event);
    const existing = sameSourceMount ? document.animations.find(candidate => candidate.id === clip.id) : null;
    if (existing) {
      // Restore the selected descendant tracks into their original owner clip.
      // Its existing action map remains authoritative, so normal runtime action
      // resolution cannot pick an emptied old clip ahead of a competing copy.
      const originalOwner = target.animations.find(candidate => candidate.id === original.id);
      const whollyOwned = originalOwner.tracks?.length && originalOwner.tracks.every(track => removedIds.has(track.nodeId));
      if (whollyOwned) Object.assign(existing, clip);
      else {
        const copiedTracks = new Set(clip.tracks.map(track => `${track.nodeId}:${track.property}`));
        existing.tracks = [...(existing.tracks || []).filter(track => !copiedTracks.has(`${track.nodeId}:${track.property}`)), ...clip.tracks];
        existing.events = (existing.events || []).filter(event => !removedIds.has(event.nodeId));
        const knownEvents = new Set(existing.events.map(event => JSON.stringify(event)));
        for (const event of clip.events) if (!knownEvents.has(JSON.stringify(event))) {
          existing.events.push(event); knownEvents.add(JSON.stringify(event));
        }
        if (existing.duration !== clip.duration || existing.loop !== clip.loop) warnings.add(`${existing.name}: shared clip timing remains owned by the parent model.`);
      }
    } else document.animations.push(clip);
  }
  for (const original of component.actionMap) {
    const existing = sameSourceMount ? document.actionMap.find(mapping => mapping.id === original.id) : null;
    if (existing) existing.clipId = clipIds.get(original.clipId);
    else document.actionMap.push({ ...deepClone(original), id: allocateId('action'), clipId: clipIds.get(original.clipId) });
  }
  document.physics.colliders.push(...(component.physics.colliders || []).map(original => {
    const collider = deepClone(original); collider.nodeId = nodeIds.get(original.nodeId);
    if (collider.id) collider.id = allocateId('collider');
    if (collider.materialId) collider.materialId = materialIds.get(collider.materialId) || null;
    if (collider.surfaceId) collider.surfaceId = surfaceIds.get(collider.surfaceId) || null;
    return collider;
  }));
  const sourceHierarchy = solComponentLibraryHierarchy(component, sourceRootId);
  const libraryInstances = [
    ...solLibraryInstanceRecords(target).filter(record => !removedIds.has(record.rootId)),
    ...(sourceHierarchy ? [{ rootId, libraryHierarchy: sourceHierarchy }] : []),
    ...copySolLibraryInstances(component, nodeIds),
  ];
  if (libraryInstances.length) document.meta.parameters.componentLibrary = { version: 1, instances: libraryInstances };
  else if (document.meta.parameters.componentLibrary) delete document.meta.parameters.componentLibrary;
  checkedNodes(document);
  return { document, rootId, warnings: warnings.values() };
}
