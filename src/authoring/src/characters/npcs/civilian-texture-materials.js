const STYLE_TEXTURES = Object.freeze([
  'civilianOrbitalUtility',
  'civilianGardenCasual',
  'civilianCivicSmart',
  'civilianNeonStreet',
  'civilianIndustrialService',
]);

export const CIVILIAN_STYLE_COUNT = STYLE_TEXTURES.length;

// Every generated atlas follows this exact 3x3 contract. Keeping the contract
// data-side means a jacket, sleeve or shoe can come from any wardrobe without
// changing geometry or loading dozens of separate images.
export const CIVILIAN_ATLAS_REGIONS = Object.freeze({
  face: Object.freeze([0, 0]),
  hair: Object.freeze([1, 0]),
  upper: Object.freeze([2, 0]),
  outer: Object.freeze([0, 1]),
  upperArm: Object.freeze([1, 1]),
  forearm: Object.freeze([2, 1]),
  trousers: Object.freeze([0, 2]),
  lowerLeg: Object.freeze([1, 2]),
  footwear: Object.freeze([2, 2]),
});

const REGION_NAMES = Object.freeze(Object.keys(CIVILIAN_ATLAS_REGIONS));

function hash32(value, salt = '') {
  const text = `${value ?? 0}|${salt}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function unit(value, salt) {
  return hash32(value, salt) / 0xffffffff;
}

/**
 * Stable per-NPC appearance recipe. Clothing regions deliberately use separate
 * salted hashes: five atlases therefore provide 5^7 practical outfit mixes,
 * while face, hair, silhouette and accessories vary independently as well.
 */
export function civilianAppearance(seed = 0, role = 'civilian') {
  const styles = {};
  for (const region of REGION_NAMES) styles[region] = hash32(seed, `civilian-${region}`) % CIVILIAN_STYLE_COUNT;
  return Object.freeze({
    seed,
    role,
    styles: Object.freeze(styles),
    skinIndex: hash32(seed, 'skin-tone') % 10,
    hairIndex: hash32(seed, 'hair-tone') % 8,
    hairShape: hash32(seed, 'hair-shape') % 5,
    accessory: hash32(seed, 'accessory') % 5,
    gloved: role === 'technician' || unit(seed, 'gloves') > .58,
    shoulderScale: .90 + unit(seed, 'shoulders') * .20,
    hipScale: .90 + unit(seed, 'hips') * .18,
    torsoDepth: .91 + unit(seed, 'torso-depth') * .17,
    headScale: .94 + unit(seed, 'head') * .11,
  });
}

const BASE_SURFACE = Object.freeze({
  mode: 4,
  scale: 1,
  blend: .96,
  tint: .045,
  repeat: false,
  offset: Object.freeze([0, 0]),
  rotation: 0,
  contrast: 1.045,
  brightness: .98,
  roughness: .82,
  emissive: 0,
  category: 'props',
  forceTexture: true,
  atlasGrid: 3,
});

export function civilianMaterial(appearance, region, overrides = {}) {
  const cell = CIVILIAN_ATLAS_REGIONS[region];
  if (!cell) throw new RangeError(`Unknown civilian atlas region: ${region}`);
  const style = Number(appearance?.styles?.[region] ?? 0) % CIVILIAN_STYLE_COUNT;
  return {
    ...BASE_SURFACE,
    texture: STYLE_TEXTURES[(style + CIVILIAN_STYLE_COUNT) % CIVILIAN_STYLE_COUNT],
    atlasCell: cell,
    atlasRegion: region,
    ...overrides,
  };
}

export function civilianStyleTextureKeys() {
  return [...STYLE_TEXTURES];
}
