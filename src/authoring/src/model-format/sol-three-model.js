import { createSolRoundedPlateGeometry } from './sol-rounded-plate.js';
import * as THREE from 'three';
import { civilianAppearance, civilianMaterial } from '../characters/npcs/civilian-texture-materials.js?v=1.0.0';
import { evaluateSolModelPose } from './sol-model-runtime.js';
import { normaliseSolMeshGeometry, solMeshFaceNormal, triangulateSolMesh } from './sol-custom-mesh.js?v=1.4.0';
import { SHIP_SURFACE_GLSL } from '../ships/ship-surface-shader.js?v=1.0.0';
import { createSolPresentationTransform } from './sol-presentation-profile.js?v=1.0.0';
import { applySolWorldPose } from './sol-world-components.js?v=1.5.0';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const finite3 = (value, fallback = [0, 0, 0]) => fallback.map((entry, axis) => finite(value?.[axis], entry));
const clamp = (value, low, high) => Math.max(low, Math.min(high, finite(value, low)));

// Texture aliases are a SOL asset-format concern, not an editor concern.  Keeping
// this table beside the shared geometry/material renderer prevents Designer and
// Explorer from resolving the same material through different URL rules.
const ROOT_ASSET_URL = new URL('../../assets/', import.meta.url);
export const SOL_TEXTURE_URLS = Object.freeze({
  pilotHelmetFront: new URL('characters/pilot/helmet-front.webp', ROOT_ASSET_URL).href,
  pilotHelmetSide: new URL('characters/pilot/helmet-side.webp', ROOT_ASSET_URL).href,
  pilotVisorJaw: new URL('characters/pilot/visor-jaw.webp', ROOT_ASSET_URL).href,
  pilotShoulder: new URL('characters/pilot/shoulder.webp', ROOT_ASSET_URL).href,
  pilotChest: new URL('characters/pilot/chest.webp', ROOT_ASSET_URL).href,
  pilotAbdomen: new URL('characters/pilot/abdomen.webp', ROOT_ASSET_URL).href,
  pilotUpperArm: new URL('characters/pilot/upper-arm.webp', ROOT_ASSET_URL).href,
  pilotForearm: new URL('characters/pilot/forearm.webp', ROOT_ASSET_URL).href,
  pilotUpperLeg: new URL('characters/pilot/upper-leg.webp', ROOT_ASSET_URL).href,
  pilotKnee: new URL('characters/pilot/knee.webp', ROOT_ASSET_URL).href,
  pilotShin: new URL('characters/pilot/shin.webp', ROOT_ASSET_URL).href,
  pilotBoot: new URL('characters/pilot/boot.webp', ROOT_ASSET_URL).href,
  pilotUndersuit: new URL('characters/pilot/undersuit.webp', ROOT_ASSET_URL).href,
  pilotGenericArmour: new URL('characters/pilot/generic-armour.webp', ROOT_ASSET_URL).href,
  pilotBelt: new URL('characters/pilot/belt.webp', ROOT_ASSET_URL).href,
  pilotRearArmour: new URL('characters/pilot/rear-armour.webp', ROOT_ASSET_URL).href,
  civilianOrbitalUtility: new URL('characters/civilians/orbital-utility-atlas.webp', ROOT_ASSET_URL).href,
  civilianGardenCasual: new URL('characters/civilians/garden-casual-atlas.webp', ROOT_ASSET_URL).href,
  civilianCivicSmart: new URL('characters/civilians/civic-smart-atlas.webp', ROOT_ASSET_URL).href,
  civilianNeonStreet: new URL('characters/civilians/neon-street-atlas.webp', ROOT_ASSET_URL).href,
  civilianIndustrialService: new URL('characters/civilians/industrial-service-atlas.webp', ROOT_ASSET_URL).href,
  concrete: new URL('textures/concrete.jpg', ROOT_ASSET_URL).href,
  brick: new URL('textures/brick.jpg', ROOT_ASSET_URL).href,
  office: new URL('textures/office_facade.jpg', ROOT_ASSET_URL).href,
  metal: new URL('textures/metal_panels.jpg', ROOT_ASSET_URL).href,
  roof: new URL('textures/roof.jpg', ROOT_ASSET_URL).href,
  windowA: new URL('textures/window_office_a.jpg', ROOT_ASSET_URL).href,
});

export function resolveSolTextureUrl(texture, { sourceUrl = '', aliases = SOL_TEXTURE_URLS } = {}) {
  const value = String(texture || '').trim();
  if (!value) return '';
  if (/^(data:|blob:|https?:)/i.test(value)) return value;
  if (aliases?.[value]) return aliases[value];
  if (value.startsWith('/')) {
    try { return new URL(value, globalThis.location?.origin || ROOT_ASSET_URL).href; } catch { return value; }
  }
  // Designer historically stored literal ../assets/... paths.  They mean the
  // project asset root, not "one directory above whichever model JSON happened
  // to load this document".
  const projectAsset = value.replace(/^(?:\.\.\/|\.\/)+/, '');
  if (projectAsset.startsWith('assets/')) return new URL(projectAsset.slice('assets/'.length), ROOT_ASSET_URL).href;
  if (value.startsWith('assets/')) return new URL(value.slice('assets/'.length), ROOT_ASSET_URL).href;
  if (sourceUrl) {
    try { return new URL(value, sourceUrl).href; } catch {}
  }
  try { return new URL(value, new URL('../../', import.meta.url)).href; } catch { return value; }
}

function effectiveRuntimeMaterial(material, document, { variant = 0, role = 'civilian' } = {}) {
  if (!material) return null;
  const native = { ...(material.native || {}) };
  const dynamicCivilian = ['civilian', 'clerk', 'technician'].includes(document?.meta?.registryId) && native.atlasRegion;
  if (dynamicCivilian) {
    const region = native.atlasRegion;
    const { texture: _texture, atlasCell: _cell, atlasRegion: _region, ...surfaceOverrides } = native;
    Object.assign(native, civilianMaterial(civilianAppearance(variant, role), region, surfaceOverrides));
  }
  return {
    ...material,
    native,
    texture: dynamicCivilian ? (native.texture || material.texture || null) : (material.texture || native.texture || null),
    opacity: finite(material.opacity, 1),
    roughness: finite(material.roughness, .65),
    metalness: finite(material.metalness, .1),
    doubleSided: Boolean(material.doubleSided || native.doubleSided),
  };
}

export function createSolThreeMaterial(solMaterial, {
  document = null,
  runtime = null,
  textureLoader = null,
  textureCache = null,
  sourceUrl = '',
  textureResolver = resolveSolTextureUrl,
} = {}) {
  const materialRecord = runtime ? effectiveRuntimeMaterial(solMaterial, document, runtime) : solMaterial;
  const color = finite3(materialRecord?.color, [.18, .22, .25]);
  const opacity = clamp(materialRecord?.opacity ?? 1, 0, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...color),
    emissive: new THREE.Color(...finite3(materialRecord?.emissive, [0, 0, 0])),
    roughness: clamp(materialRecord?.roughness ?? .65, 0, 1),
    metalness: clamp(materialRecord?.metalness ?? .1, 0, 1),
    opacity,
    transparent: opacity < .999,
    side: materialRecord?.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: opacity >= .999,
  });
  const loader = textureLoader || new THREE.TextureLoader();
  const native = materialRecord?.native || {};
  if (native.shipSurface?.kind === 'surface' || native.shipSurface?.kind === 'decal') {
    applySolShipSurface(material, materialRecord, { loader, textureCache, sourceUrl, textureResolver });
    material.userData.solMaterialId = solMaterial?.id || null;
    return material;
  }
  const url = textureResolver(materialRecord?.texture, { sourceUrl });
  if (url) {
    const atlasGrid = Math.max(0, finite(native.atlasGrid, 0));
    const atlasCell = native.atlasCell;
    const repeat = finite3([...(materialRecord?.textureRepeat || [1, 1]), 1], [1, 1, 1]).slice(0, 2);
    const textureKey = `${url}|${atlasGrid}|${Array.isArray(atlasCell) ? atlasCell.join(',') : ''}|${repeat.join(',')}`;
    let map = textureCache?.get(textureKey) || null;
    if (!map) {
      map = loader.load(url, loaded => { loaded.needsUpdate = true; }, undefined, () => {});
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      if (textureCache) textureCache.set(textureKey, map);
    }
    if (atlasGrid > 0 && Array.isArray(atlasCell)) {
      map.repeat.set(1 / atlasGrid, 1 / atlasGrid);
      map.offset.set(finite(atlasCell[0], 0) / atlasGrid, 1 - (finite(atlasCell[1], 0) + 1) / atlasGrid);
    } else map.repeat.set(repeat[0], repeat[1]);
    material.map = map;
    if(native.forceTexture&&Number.isFinite(Number(native.tint))){
      const tint=clamp(Number(native.tint),0,1),brightness=clamp(native.brightness??1,0,2);
      material.color.setRGB(...color.map(v=>(1+(v-1)*tint)*brightness));
    }
    material.needsUpdate = true;
  }
  material.userData.solMaterialId = solMaterial?.id || null;
  return material;
}

// Keep the indexed raw-game/Gallery surface evaluator for editable captures.
// Three still owns its lighting; source metre mapping, packed R/G/B channels,
// micro-height and image-top-left decal coordinates remain the same recipe.
function applySolShipSurface(material, record, { loader, textureCache, sourceUrl, textureResolver }) {
  const native = record.native, surface = native.shipSurface;
  const decal = surface.kind === 'decal';
  const originalColor = finite3(native.shipBaseColor, finite3(record.color, [1, 1, 1]));
  const tint = finite3(surface.tint, [1, 1, 1]).map((value, axis) =>
    value * (Math.abs(originalColor[axis]) > 1e-6 ? finite(record.color?.[axis], originalColor[axis]) / originalColor[axis] : 1));
  const uniforms = {
    uShipAlbedo: { value: null }, uShipSurface: { value: null },
    uShipEnabled: { value: 0 }, uShipDecal: { value: decal ? 1 : 0 },
    uShipScale: { value: 1 / Math.max(.001, finite(surface.tileMetres, 1)) },
    uShipBump: { value: finite(surface.bump, 0) },
    uShipTexel: { value: finite(surface.texelSize, 1 / 512) },
    uShipOpacity: { value: decal ? 1 : finite(surface.opacity, 1) },
    uShipTint: { value: new THREE.Vector3(...tint) },
    uShipRect: { value: new THREE.Vector4(...(surface.uvRect || [0, 0, 1, 1])) },
    uSolShipRoughness: { value: finite(record.roughness, .65) / Math.max(.001, finite(native.shipBaseRoughness, finite(record.roughness, .65))) },
    uSolShipMetalness: { value: finite(record.metalness, .1) - finite(native.shipBaseMetalness, finite(record.metalness, .1)) },
  };
  const ready = [];
  const updateReady = () => {
    uniforms.uShipEnabled.value = ready.every(item => item.loaded) ? 1 : 0;
  };
  const load = (path, repeat) => {
    const url = textureResolver(path, { sourceUrl });
    const key = `ship|${url}|${repeat}`;
    let map = textureCache?.get(key);
    const state = { loaded: Boolean(map?.image?.complete && map.image.naturalWidth) };
    ready.push(state);
    if (!map) {
      map = loader.load(url, loaded => {
        loaded.userData.solShipLoaded = true;
        state.loaded = true; updateReady();
        for (const notify of loaded.userData.solShipWaiters || []) notify();
        loaded.userData.solShipWaiters = [];
      }, undefined, () => updateReady());
      // Raw ship textures are uploaded without a Y flip or colour conversion.
      map.flipY = false;
      map.colorSpace = THREE.NoColorSpace;
      map.wrapS = map.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      if (textureCache) textureCache.set(key, map);
    } else if (!state.loaded) {
      // Cached asynchronous loads notify all materials, without extra requests.
      map.userData.solShipWaiters ||= [];
      map.userData.solShipWaiters.push(() => { state.loaded = true; updateReady(); });
    }
    return map;
  };
  uniforms.uShipAlbedo.value = load(decal ? surface.texture : surface.albedo, !decal);
  uniforms.uShipSurface.value = decal ? uniforms.uShipAlbedo.value : load(surface.surface, true);
  if (decal) {
    material.transparent = true; material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
  }
  updateReady();
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\nattribute vec3 solShipPosition;\nvarying vec3 vSolShipPosition;\nvarying vec2 vSolShipUv;\nvarying vec3 vSolShipNormal;\nvarying mat3 vSolShipNormalToView;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSolShipPosition = solShipPosition;\nvSolShipUv = uv;\nvSolShipNormal = vec3(-normal.z, normal.x, normal.y);\nvSolShipNormalToView = normalMatrix;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vSolShipPosition;\nvarying vec2 vSolShipUv;\nvarying vec3 vSolShipNormal;\nvarying mat3 vSolShipNormalToView;\nuniform float uSolShipRoughness;\nuniform float uSolShipMetalness;\n${SHIP_SURFACE_GLSL}`)
      .replace('#include <map_fragment>', `vec3 solShipColour = diffuseColor.rgb;\nfloat solShipRoughness = roughness;\nfloat solShipMetalness = metalness;\nvec3 solShipNormal;\nfloat solShipAlpha;\nsampleShipSurface(vSolShipPosition, vSolShipNormal, vSolShipUv, solShipColour, solShipRoughness, solShipMetalness, solShipNormal, solShipAlpha);\ndiffuseColor.rgb = solShipColour;\ndiffuseColor.a *= (uShipDecal > .5 && uShipEnabled < .5) ? 0.0 : solShipAlpha;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = (uShipEnabled > .5 && uShipDecal < .5) ? clamp(solShipRoughness * uSolShipRoughness, .045, 1.0) : solShipRoughness;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\nmetalnessFactor = (uShipEnabled > .5 && uShipDecal < .5) ? clamp(solShipMetalness + uSolShipMetalness, 0.0, 1.0) : solShipMetalness;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nif (uShipEnabled > .5 && uShipDecal < .5) normal = normalize(vSolShipNormalToView * vec3(solShipNormal.y, solShipNormal.z, -solShipNormal.x));`);
  };
  material.customProgramCacheKey = () => 'sol-shared-ship-surface.v1';
  material.userData.solShipSurface = { kind: surface.kind, materialId: surface.materialId || surface.decalId };
}

export function createSolTaperedGeometry(startSize = [.1, .1], endSize = [.08, .08], segments = 20) {
  const positions = [];
  const indices = [];
  for (let ring = 0; ring < 2; ring += 1) {
    const size = ring ? endSize : startSize;
    const y = ring ? .5 : -.5;
    for (let index = 0; index < segments; index += 1) {
      const angle = index / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * finite(size?.[0], .1), y, Math.sin(angle) * finite(size?.[1], finite(size?.[0], .1)));
    }
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    indices.push(index, next, segments + next, index, segments + next, segments + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function orientSegment(object, start, end) {
  const a = new THREE.Vector3().fromArray(finite3(start, [0, 0, 0]));
  const b = new THREE.Vector3().fromArray(finite3(end, [0, 1, 0]));
  const delta = b.clone().sub(a);
  object.position.copy(a).add(b).multiplyScalar(.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  return Math.max(.0001, delta.length());
}

export function createSolMeshFaceGeometry(source, faceIndex) {
  const mesh = normaliseSolMeshGeometry(source);
  const face = mesh.faces[faceIndex];
  const geometry = new THREE.BufferGeometry();
  if (!face) return geometry;
  const normal = new THREE.Vector3(...solMeshFaceNormal(mesh, faceIndex));
  const positions = [];
  const uvs = [];
  const dominant = Math.abs(normal.y) >= Math.max(Math.abs(normal.x), Math.abs(normal.z)) ? 'y'
    : Math.abs(normal.x) >= Math.abs(normal.z) ? 'x' : 'z';
  const uv = vertex => dominant === 'y' ? [vertex[0], vertex[2]] : dominant === 'x' ? [vertex[2], vertex[1]] : [vertex[0], vertex[1]];
  for (let corner = 1; corner < face.vertices.length - 1; corner += 1) {
    for (const index of [face.vertices[0], face.vertices[corner], face.vertices[corner + 1]]) {
      const vertex = mesh.vertices[index];
      positions.push(...vertex);
      uvs.push(...(mesh.uvs?.[index] || uv(vertex)));
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Runtime parity invariant: authored custom faces carry the exact UV stream
  // Designer previews.  The old Explorer renderer discarded this attribute and
  // invented triplanar coordinates, which is why textures never matched.
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (mesh.normals) {
    const normals = [];
    for (let corner = 1; corner < face.vertices.length - 1; corner += 1)
      for (const index of [face.vertices[0], face.vertices[corner], face.vertices[corner + 1]]) normals.push(...mesh.normals[index]);
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function cloneFaceMaterial(material) {
  const result = material?.clone?.() || material || new THREE.MeshStandardMaterial({ color: 0x34434a });
  if (material) { result.onBeforeCompile = material.onBeforeCompile; result.customProgramCacheKey = material.customProgramCacheKey; }
  return result;
}

function solBatchGeometry(batch, source) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
  const uvs = batch.uvs || [];
  if (!batch.uvs) {
    for (let index = 0; index < batch.positions.length; index += 3) {
      const p = batch.positions.slice(index, index + 3), n = batch.normals.slice(index, index + 3);
      const dominant = Math.abs(n[1]) >= Math.max(Math.abs(n[0]), Math.abs(n[2])) ? 1 : Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : 2;
      uvs.push(...(dominant === 1 ? [p[0], p[2]] : dominant === 0 ? [p[2], p[1]] : [p[0], p[1]]));
    }
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const origin = finite3(source.shipOrigin);
  const shipPositions = [];
  for (let index = 0; index < batch.positions.length; index += 3)
    shipPositions.push(-batch.positions[index + 2] + origin[0], batch.positions[index] + origin[1], batch.positions[index + 1] + origin[2]);
  geometry.setAttribute('solShipPosition', new THREE.Float32BufferAttribute(shipPositions, 3));
  geometry.setIndex(batch.indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Rebuild vertex buffers after a drag while retaining batched material ownership. */
export function refreshSolThreeMeshObject(wrapper, node) {
  if (node?.type !== 'mesh' || !wrapper) return;
  const batches = triangulateSolMesh(node.geometry, node.materialId);
  const byMaterial = new Map(batches.map(batch => [batch.materialId || null, batch]));
  for (const child of wrapper.children.filter(entry => entry.userData.solCustomFace)) {
    const batch = byMaterial.get(child.userData.solMaterialId);
    if (!batch) continue;
    const next = solBatchGeometry(batch, node.geometry);
    child.geometry.dispose(); child.geometry = next;
    child.userData.solFaceIndices = batch.faceIndices;
  }
}

export function createSolThreeNodeObject(node, fallbackMaterial, materialMap = new Map()) {
  if (node.type === 'group') return new THREE.Group();
  if (node.type === 'mesh') {
    const wrapper = new THREE.Group();
    for (const batch of triangulateSolMesh(node.geometry, node.materialId)) {
      const materialId = batch.materialId || null;
      const sourceMaterial = materialMap.get(materialId) || fallbackMaterial;
      const faceMesh = new THREE.Mesh(solBatchGeometry(batch, node.geometry), cloneFaceMaterial(sourceMaterial));
      faceMesh.name = `Faces · ${materialId || 'default'}`;
      faceMesh.userData.solNodeId = node.id;
      faceMesh.userData.solMaterialId = materialId;
      faceMesh.userData.solFaceIndices = batch.faceIndices;
      faceMesh.userData.solCustomFace = true;
      faceMesh.castShadow = finite(sourceMaterial?.opacity, 1) >= .6 && sourceMaterial?.userData?.solShipSurface?.kind !== 'decal';
      faceMesh.receiveShadow = true;
      wrapper.add(faceMesh);
    }
    return wrapper;
  }

  const capturedSegment = Array.isArray(node.geometry?.start) && Array.isArray(node.geometry?.end);
  if (capturedSegment) {
    const wrapper = new THREE.Group();
    const segmentRoot = new THREE.Group();
    const start = finite3(node.geometry.start, [0, 0, 0]);
    const end = finite3(node.geometry.end, [0, 1, 0]);
    const length = Math.max(.0001, new THREE.Vector3().fromArray(end).distanceTo(new THREE.Vector3().fromArray(start)));
    const geometry = node.type === 'taper'
      ? createSolTaperedGeometry(node.geometry.startSize, node.geometry.endSize)
      : new THREE.CapsuleGeometry(Math.max(.006, finite(node.geometry.diameter, .08) * .5), Math.max(.001, length - finite(node.geometry.diameter, .08)), 5, 12);
    const mesh = new THREE.Mesh(geometry, fallbackMaterial);
    mesh.userData.solNodeId = node.id;
    mesh.userData.solMaterialId = node.materialId || null;
    if (node.type === 'taper') mesh.scale.y = length;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    segmentRoot.add(mesh);
    orientSegment(segmentRoot, start, end);
    wrapper.add(segmentRoot);
    return wrapper;
  }

  let geometry;
  if (node.type === 'plate' && node.geometry?.sourceMesh === 'characterPlate') {
    const plate=createSolRoundedPlateGeometry();geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(plate.positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(plate.normals,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(plate.uvs,2));
    geometry.setIndex(plate.indices);
  }
  else if (node.type === 'sphere') geometry = new THREE.SphereGeometry(1, 28, 18);
  else if (node.type === 'cylinder') geometry = new THREE.CylinderGeometry(1, 1, 2, 24, 2);
  else if (node.type === 'capsule') geometry = new THREE.CapsuleGeometry(1, .8, 6, 16);
  else if (node.type === 'taper') geometry = createSolTaperedGeometry(node.geometry?.startSize, node.geometry?.endSize);
  else geometry = new THREE.BoxGeometry(2, 2, 2, node.type === 'plate' ? 2 : 1, node.type === 'plate' ? 2 : 1, node.type === 'plate' ? 2 : 1);
  const mesh = new THREE.Mesh(geometry, fallbackMaterial);
  mesh.userData.solNodeId = node.id;
  mesh.userData.solMaterialId = node.materialId || null;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const wrapper = new THREE.Group();
  const size = finite3(node.geometry?.size, [1, 1, 1]);
  mesh.scale.fromArray(size);
  wrapper.add(mesh);
  return wrapper;
}

export function disposeSolThreeObject(object, { disposeTextures = false } = {}) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  object?.traverse?.(child => {
    if (child.geometry) geometries.add(child.geometry);
    const list = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const material of list) {
      materials.add(material);
      if (disposeTextures && material.map) textures.add(material.map);
    }
  });
  geometries.forEach(geometry => geometry.dispose?.());
  materials.forEach(material => material.dispose?.());
  textures.forEach(texture => texture.dispose?.());
}

export function createSolThreeModel(document, options = {}) {
  const textureLoader = options.textureLoader || new THREE.TextureLoader();
  const textureCache = options.textureCache || new Map();
  const sourceUrl = options.sourceUrl || '';
  const root = new THREE.Group();
  root.name = `SOL · ${document?.meta?.name || document?.meta?.id || 'model'}`;
  const presentationRoot = new THREE.Group();
  presentationRoot.name = 'SOL presentation root';
  root.add(presentationRoot);
  const objectById = new Map();
  const baseMaterials = new Map((document?.materials || []).map(material => [material.id, createSolThreeMaterial(material, {
    document, textureLoader, textureCache, sourceUrl,
  })]));
  const defaultMaterial = baseMaterials.values().next().value || new THREE.MeshStandardMaterial({ color: 0x34434a });

  for (const node of document?.nodes || []) {
    const object = createSolThreeNodeObject(node, baseMaterials.get(node.materialId) || defaultMaterial.clone(), baseMaterials);
    object.name = node.name || node.id;
    object.userData.solNodeId = node.id;
    object.visible = node.visible !== false;
    object.position.fromArray(finite3(node.transform?.position, [0, 0, 0]));
    object.rotation.set(...finite3(node.transform?.rotation, [0, 0, 0]));
    object.scale.fromArray(finite3(node.transform?.scale, [1, 1, 1]));
    objectById.set(node.id, object);
  }
  for (const node of document?.nodes || []) {
    const object = objectById.get(node.id);
    const parent = objectById.get(node.parentId) || presentationRoot;
    parent.add(object);
  }

  const runtimeMaterialMaps = new Map();
  let activeRuntimeMaterialKey = '';
  function runtimeMaterialKey(runtime = {}) {
    return `${Math.trunc(finite(runtime.variant, 0))}|${String(runtime.role || 'civilian')}`;
  }
  function runtimeMaterialMap(runtime = {}) {
    const key = runtimeMaterialKey(runtime);
    if (runtimeMaterialMaps.has(key)) return runtimeMaterialMaps.get(key);
    const map = new Map((document?.materials || []).map(material => [material.id, createSolThreeMaterial(material, {
      document, runtime, textureLoader, textureCache, sourceUrl,
    })]));
    runtimeMaterialMaps.set(key, map);
    return map;
  }

  function applyRuntimeMaterials(runtime = {}) {
    const key = runtimeMaterialKey(runtime);
    if (key === activeRuntimeMaterialKey) return;
    const map = runtimeMaterialMap(runtime);
    root.traverse(child => {
      if (!child.isMesh) return;
      const id = child.userData.solMaterialId;
      const source = map.get(id) || map.values().next().value;
      if (!source) return;
      // Runtime faces do not need editor-local clones. Release the construction
      // clone once, then share the resolved material for this appearance. This
      // avoids allocating/discarding one MeshStandardMaterial per face per frame.
      if (child.userData.solCustomFace && !child.userData.solRuntimeMaterialBound) {
        if (child.material && child.material !== source) child.material.dispose?.();
        child.userData.solRuntimeMaterialBound = true;
      }
      child.material = source;
    });
    activeRuntimeMaterialKey = key;
  }

  function update({
    cycle = 0,
    speed = 0,
    moving = false,
    action = null,
    surfaceMode = 'ground',
    weapon = 'any',
    variant = 0,
    role = 'civilian',
    presentation = null,
    scale = 1,
    worldPose = null,
    motionWeight = moving ? 1 : 0,
    aiming = false,
    aimWeight = aiming ? 1 : 0,
    grounded = true,
    direction = [0, 1],
    animationTime = null,
  } = {}) {
    const pose = evaluateSolModelPose(document, { action, cycle, animationTime, speed, moving, surfaceMode, weapon, motionWeight, aiming, aimWeight, grounded, direction });
    for (const node of document?.nodes || []) {
      const object = objectById.get(node.id);
      if (!object) continue;
      const animated = pose.get(node.id) || {};
      const transform = applySolWorldPose({
        position: animated.position || node.transform?.position,
        rotation: animated.rotation || node.transform?.rotation,
        scale: animated.scale || node.transform?.scale,
      }, worldPose?.get?.(node.id) || {});
      object.position.fromArray(finite3(transform.position, [0, 0, 0]));
      object.rotation.set(...finite3(transform.rotation, [0, 0, 0]));
      object.scale.fromArray(finite3(transform.scale, [1, 1, 1]));
      object.visible = node.visible !== false;
    }
    const present = createSolPresentationTransform(presentation);
    presentationRoot.position.fromArray(present.position);
    presentationRoot.rotation.set(...present.rotation);
    presentationRoot.scale.fromArray(present.scale.map(value => value * finite(scale, 1)));
    applyRuntimeMaterials({ variant, role });
    root.updateMatrixWorld(true);
  }

  function dispose() {
    disposeSolThreeObject(root);
    for (const map of runtimeMaterialMaps.values()) for (const material of map.values()) material.dispose?.();
    for (const material of baseMaterials.values()) material.dispose?.();
    runtimeMaterialMaps.clear();
  }

  return { root, presentationRoot, objectById, baseMaterials, textureCache, update, dispose };
}

// CharacterFrame is deliberately left-handed (+Z is "facing forward").  Do not
// decompose this into a quaternion: the reflection is real and is required for
// exact parity with SOL capture.  A raw basis matrix preserves it losslessly.
export function setSolThreeFrameMatrix(object, frame, { rebase = [0, 0, 0] } = {}) {
  if (!object || !frame) return;
  const right = finite3(frame.right, [1, 0, 0]);
  const up = finite3(frame.up, [0, 1, 0]);
  const forward = finite3(frame.forward, [0, 0, -1]);
  const origin = finite3(frame.origin, [0, 0, 0]).map((value, axis) => value - finite(rebase?.[axis], 0));
  object.matrixAutoUpdate = false;
  object.matrix.set(
    right[0], up[0], forward[0], origin[0],
    right[1], up[1], forward[1], origin[1],
    right[2], up[2], forward[2], origin[2],
    0, 0, 0, 1,
  );
  object.matrixWorldNeedsUpdate = true;
}
