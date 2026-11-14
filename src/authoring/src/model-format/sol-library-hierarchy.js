/** Descriptive ship ancestry for reusable copies. This data never authorizes
 * a file read, a game assignment, or a lookup of arbitrary source geometry. */
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0
  && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  && ![...value].some(character => character.length === 1 && /[\ud800-\udfff]/.test(character));
const recipeId = value => text(value, 96) && /^[a-z0-9][a-z0-9_-]*$/.test(value);

export function solShipLibraryAssetId(shipId, zone = '', path = '') {
  if (!recipeId(shipId) || zone && !recipeId(zone)
    || path && (!zone || !text(path, 384) || !path.split('/').every(recipeId))) {
    throw new TypeError('A valid ship, section and named component path are required.');
  }
  if (path) return `player-ship-component:${shipId}:${zone}:${encodeURIComponent(path)}`;
  return zone ? `player-ship-section:${shipId}:${zone}` : `player-ship:${shipId}`;
}

export function normaliseSolLibraryHierarchy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !text(value.shipId, 96) || !text(value.shipName, 128)
    || !Array.isArray(value.path) || value.path.length > 16
    || !value.path.every(entry => entry && typeof entry === 'object'
      && text(entry.id, 512) && text(entry.name, 128))
    || typeof value.parentAssetId !== 'string' || value.parentAssetId && !text(value.parentAssetId, 512)
    || !['ship', 'section', 'component'].includes(value.level)) return null;
  return { shipId: value.shipId, shipName: value.shipName,
    path: value.path.map(entry => ({ id: entry.id, name: entry.name })),
    parentAssetId: value.parentAssetId, level: value.level };
}

/** An independent saved ship can own a library branch without claiming a
 * procedural player hull or runtime slot. Its logical ID is never a path. */
export function solSavedShipLibraryHierarchy(document) {
  const meta = document?.meta;
  if (meta?.kind !== 'ship' || meta.registryId || meta.runtimeSlot) return null;
  const hierarchy = normaliseSolLibraryHierarchy(meta.parameters?.libraryHierarchy);
  return hierarchy && hierarchy.level === 'ship' && !hierarchy.path.length
    && !hierarchy.parentAssetId && recipeId(hierarchy.shipId) ? hierarchy : null;
}

export function solShipComponentCategory(path) {
  if (/^bridge-controls\/seat(?:\/|$)|^crew-stations\/crew-seat-/.test(path)) return 'seating';
  if (/^bridge-controls\/monitors(?:\/|$)|^crew-stations\/consoles$/.test(path)) return 'displays';
  if (/^bridge-controls\/(?:controls|pedals)(?:\/|$)/.test(path)) return 'controls';
  if (/^cabin\/(?:storage|cargo|service-cabinet)(?:\/|$)/.test(path)) return 'furnishings';
  return 'structure';
}

/** Classification describes declared recipe ownership only. It never changes
 * the destination path chosen by the user or a file's optimistic identity. */
export function solLibraryHierarchyCategory(value) {
  const hierarchy = normaliseSolLibraryHierarchy(value);
  if (!hierarchy) return '';
  const id = hierarchy.path.at(-1)?.id || '', prefix = `player-ship-component:${hierarchy.shipId}:`;
  if (!id.startsWith(prefix)) return 'structure';
  try { return solShipComponentCategory(decodeURIComponent(id.slice(id.indexOf(':', prefix.length) + 1))); }
  catch { return 'structure'; }
}

export function solShipLibraryHierarchy({ shipId, shipName, zone = '', zoneName = '', groups = [] }) {
  const path = zone ? [{ id: solShipLibraryAssetId(shipId, zone), name: zoneName }] : [];
  for (const group of groups) path.push({ id: solShipLibraryAssetId(shipId, zone, group.path), name: group.name });
  const hierarchy = normaliseSolLibraryHierarchy({ shipId, shipName, path,
    parentAssetId: path.length > 1 ? path.at(-2).id : zone ? solShipLibraryAssetId(shipId) : '',
    level: groups.length ? 'component' : zone ? 'section' : 'ship' });
  if (!hierarchy) throw new TypeError('Ship library ancestry exceeds the bounded descriptive metadata contract.');
  return hierarchy;
}

const nodeTag = (node, prefix) => (node?.tags || []).find(tag => tag.startsWith(prefix))?.slice(prefix.length) || '';
const zoneLabel = (document, zone) => document.nodes.find(node => node.type === 'group'
  && node.id === 'player-zone-' + zone)?.name || zone[0]?.toUpperCase() + zone.slice(1);

export function solLibraryInstanceRecords(document) {
  const instances = document.meta?.parameters?.componentLibrary?.instances;
  if (!Array.isArray(instances)) return [];
  const groups = new Set((document.nodes || []).filter(node => node.type === 'group').map(node => node.id)), seen = new Set();
  return instances.flatMap(record => {
    const hierarchy = normaliseSolLibraryHierarchy(record?.libraryHierarchy);
    if (!hierarchy || !groups.has(record.rootId) || seen.has(record.rootId)) return [];
    seen.add(record.rootId); return [{ rootId: record.rootId, libraryHierarchy: hierarchy }];
  });
}

/** For editor Duplicate: append these mapped records after copying the nodes.
 * Records without a copied owning root are deliberately excluded. */
export function copySolLibraryInstances(document, nodeIds) {
  if (!(nodeIds instanceof Map)) throw new TypeError('Copied node identities must be a Map.');
  const records = solLibraryInstanceRecords(document).filter(record => nodeIds.has(record.rootId))
    .map(record => ({ rootId: nodeIds.get(record.rootId), libraryHierarchy: record.libraryHierarchy }));
  // A freshly duplicated named capture group has no instance record yet.
  // Preserve its explicit ownership at the copied subtree boundary as well.
  for (const node of document.nodes || []) if (node.type === 'group' && nodeIds.has(node.id)
    && !nodeIds.has(node.parentId) && !records.some(record => record.rootId === nodeIds.get(node.id))) {
    const hierarchy = solComponentLibraryHierarchy(document, node.id);
    if (hierarchy) records.push({ rootId: nodeIds.get(node.id), libraryHierarchy: hierarchy });
  }
  return records;
}

function namedSubgroupHierarchy(document, selected, retained, scope = null) {
  const zone = nodeTag(selected, 'ship-zone:'), path = nodeTag(selected, 'ship-component:');
  if (!zone || !path) return null;
  const entries = path.split('/');
  const groups = entries.map((_, index) => {
    const groupPath = entries.slice(0, index + 1).join('/'), id = solShipLibraryAssetId(retained.shipId, zone, groupPath);
    const saved = retained.path.find(entry => entry.id === id);
    const node = document.nodes.find(candidate => candidate.type === 'group' && (!scope || scope.has(candidate.id))
      && nodeTag(candidate, 'ship-zone:') === zone && nodeTag(candidate, 'ship-component:') === groupPath);
    return saved || node ? { path: groupPath, name: saved?.name || node.name } : null;
  });
  const section = retained.path.find(entry => entry.id === solShipLibraryAssetId(retained.shipId, zone))
    || document.nodes.find(node => node.type === 'group' && (!scope || scope.has(node.id))
      && nodeTag(node, 'ship-zone:') === zone && !nodeTag(node, 'ship-component:'));
  return section && groups.every(Boolean) ? solShipLibraryHierarchy({ shipId: retained.shipId,
    shipName: retained.shipName, zone, zoneName: section.name, groups }) : null;
}

/** Obtain ownership from a real capture's declaration table, or retain the
 * descriptive ancestry of an already independent component. No mesh leaf is
 * promoted to a catalogue entry by this helper. */
function componentLibraryHierarchy(document, nodeId) {
  const selected = document.nodes?.find(node => node.id === nodeId);
  if (selected?.type !== 'group') return null;
  const existing = document.meta?.parameters?.component;
  const retained = normaliseSolLibraryHierarchy(existing?.libraryHierarchy);
  if (retained && existing.rootId === nodeId) return retained;
  // A borrowed Resolute chair in a Kestrel document retains Resolute ancestry.
  // Only a root-owned instance or one of its descendants supplies affiliation;
  // a custom assembly containing several instances has no guessed source ship.
  const instances = new Map(solLibraryInstanceRecords(document).map(record => [record.rootId, record.libraryHierarchy]));
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  let owner = selected;
  while (owner) {
    const hierarchy = instances.get(owner.id);
    if (hierarchy) {
      if (owner.id === selected.id) return hierarchy;
      const scope = new Set([owner.id]);
      for (let size = -1; size !== scope.size;) {
        size = scope.size; for (const node of document.nodes) if (scope.has(node.parentId)) scope.add(node.id);
      }
      const selectedZone = nodeTag(selected, 'ship-zone:');
      if (selectedZone && !nodeTag(selected, 'ship-component:')) {
        return solShipLibraryHierarchy({ shipId: hierarchy.shipId, shipName: hierarchy.shipName,
          zone: selectedZone, zoneName: selected.name });
      }
      return namedSubgroupHierarchy(document, selected, hierarchy, scope);
    }
    owner = nodes.get(owner.parentId);
  }
  // A saved variant has its own named assemblies. Retain that ancestry when
  // extracting a reusable section/group instead of attributing it to the
  // original procedural hull mentioned in its historical capture metadata.
  const savedShip = solSavedShipLibraryHierarchy(document);
  if (savedShip) {
    const roots = document.nodes.filter(node => !node.parentId);
    if (roots.length === 1 && selected.id === roots[0].id) return savedShip;
    const zone = nodeTag(selected, 'ship-zone:'), path = nodeTag(selected, 'ship-component:');
    if (zone && !path) return solShipLibraryHierarchy({ shipId: savedShip.shipId,
      shipName: savedShip.shipName, zone, zoneName: selected.name });
    return namedSubgroupHierarchy(document, selected, savedShip);
  }
  const player = document.meta?.parameters?.playerShip;
  if (player && recipeId(player.id) && text(document.meta.name, 128)) {
    const groups = Array.isArray(player.components) ? player.components : [];
    const component = groups.find(group => group.nodeId === nodeId);
    if (component) {
      const chain = component.path.split('/').map((_, index, entries) =>
        groups.find(group => group.zone === component.zone && group.path === entries.slice(0, index + 1).join('/')));
      if (chain.every(Boolean)) return solShipLibraryHierarchy({ shipId: player.id, shipName: document.meta.name,
        zone: component.zone, zoneName: zoneLabel(document, component.zone), groups: chain });
    }
    const zone = nodeTag(selected, 'ship-zone:');
    if (zone && selected.id === 'player-zone-' + zone && selected.parentId === 'player-hull-root') {
      return solShipLibraryHierarchy({ shipId: player.id, shipName: document.meta.name, zone, zoneName: selected.name });
    }
    if (selected.id === 'player-hull-root' && !selected.parentId) {
      return solShipLibraryHierarchy({ shipId: player.id, shipName: document.meta.name });
    }
  }
  // A smaller named subgroup of a saved chair/monitor still belongs to its
  // original ship branch. Prefix labels come from saved provenance; remaining
  // labels come from actual retained named groups, never mesh-name guesses.
  if (retained) return namedSubgroupHierarchy(document, selected, retained);
  return null;
}

export function solComponentLibraryHierarchy(document, nodeId) {
  // Malformed descriptive metadata never prevents editing an otherwise valid
  // legacy document. It cannot authorize a source catalogue lookup either.
  try { return componentLibraryHierarchy(document, nodeId); } catch { return null; }
}
