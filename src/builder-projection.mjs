import * as THREE from '../vendor/three-0.160.1/build/three.module.js';

const DIRECTIONS = {
  front: [[1,0,0],[0,1,0],[0,0,1]], back: [[-1,0,0],[0,1,0],[0,0,-1]],
  right: [[0,0,-1],[0,1,0],[1,0,0]], left: [[0,0,1],[0,1,0],[-1,0,0]],
  top: [[1,0,0],[0,0,-1],[0,1,0]], bottom: [[1,0,0],[0,0,1],[0,-1,0]]
};
const SIZE = 512, MAX_RASTER_SAMPLES = 24000000;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function requireValue(value, message) { if (!value) throw new Error(message); }
function canvasFor(width, height) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width,height);
  canvas.width = width; canvas.height = height;
  return canvas;
}
async function sourceCanvas(blob) {
  requireValue(blob instanceof Blob && blob.size > 0 && blob.size <= 32*1024*1024, 'Choose a reference image smaller than 32 MiB.');
  requireValue(/^image\/(png|jpeg|webp)$/i.test(blob.type), 'Reference projection accepts PNG, JPEG or WEBP images.');
  let image;
  if (typeof createImageBitmap === 'function') image = await createImageBitmap(blob);
  else {
    requireValue(typeof Image !== 'undefined', 'Image decoding is unavailable in this environment.');
    const url = URL.createObjectURL(blob);
    try { image = await new Promise((resolve,reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error('The reference image could not be decoded.')); element.src = url; }); }
    finally { URL.revokeObjectURL(url); }
  }
  try {
    const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
    requireValue(width > 0 && height > 0 && width*height <= 64*1024*1024, 'The reference image is empty or exceeds 64 megapixels.');
    const ratio = Math.min(1, 2048/Math.max(width,height));
    const canvas = canvasFor(Math.max(1,Math.round(width*ratio)),Math.max(1,Math.round(height*ratio)));
    const context = canvas.getContext('2d'); requireValue(context, 'A 2D canvas is required for reference projection.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return {canvas, reduced: ratio < 1};
  } finally { image.close?.(); }
}

// Independent materials/textures prevent replacement or disposal of this edit from
// touching the source asset. Canvas sources also survive ImageBitmap disposal.
function cloneResources(object) {
  const materials = new Map(), textures = new Map(), geometries = new Map();
  function textureCopy(texture) {
    if (textures.has(texture)) return textures.get(texture);
    const copy = texture.clone(), image = texture.image;
    if (image?.data && ArrayBuffer.isView(image.data)) copy.source = new THREE.Source({...image,data:image.data.slice()});
    else if (image?.width > 0 && image?.height > 0) {
      const canvas = canvasFor(image.width,image.height), context = canvas.getContext('2d');
      requireValue(context,'A 2D canvas is required to retain the existing texture.');
      context.drawImage(image,0,0); copy.source = new THREE.Source(canvas);
    }
    copy.needsUpdate = true; textures.set(texture,copy); return copy;
  }
  function materialCopy(material) {
    if (materials.has(material)) return materials.get(material);
    const copy = material.clone();
    for (const [key,value] of Object.entries(material)) if (value?.isTexture) copy[key] = textureCopy(value);
    materials.set(material,copy); return copy;
  }
  object.traverse(node => {
    if (node.geometry) { if (!geometries.has(node.geometry)) geometries.set(node.geometry,node.geometry.clone()); node.geometry = geometries.get(node.geometry); }
    if (node.material) node.material = Array.isArray(node.material) ? node.material.map(materialCopy) : materialCopy(node.material);
  });
}
function disposeResources(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of [node.material].flat().filter(Boolean)) { materials.add(material); for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); }
  });
  for (const texture of textures) texture.dispose(); for (const material of materials) material.dispose(); for (const geometry of geometries) geometry.dispose();
}
function faceMaterial(geometry, materials, offset) {
  if (!Array.isArray(materials)) return materials;
  const group = geometry.groups.find(group => offset >= group.start && offset < group.start+group.count);
  return group ? materials[group.materialIndex] : geometry.groups.length ? null : materials[0];
}

/**
 * Project a raster reference from a cardinal direction. The returned object owns
 * its resources; the input is untouched. Visible-face selection uses a 512px
 * scene-wide depth raster sampled at triangle centres (an approximation).
 * scale > 1 enlarges the image; offsets move it in image-width/height units.
 * Ordinary UVs, embedded image and lightly offset overlay triangles survive GLB.
 */
export async function projectReference(input, blob, options = {}) {
  const {direction = 'front', scale = 1, widthScale=1,heightScale=1, offsetX = 0, offsetY = 0, flipX = false} = options;
  requireValue(input?.isObject3D, 'Open a model before projecting its reference.');
  requireValue(DIRECTIONS[direction], 'Choose Front, Back, Left, Right, Top or Bottom.');
  requireValue(Number.isFinite(scale) && scale >= .01 && scale <= 100, 'Projection scale must be between 0.01 and 100.');
  requireValue([offsetX,offsetY].every(value => Number.isFinite(value) && Math.abs(value) <= 10), 'Projection offsets must be between -10 and 10.');
  const decoded = await sourceCanvas(blob);
  const object = input.clone(true);
  let resourcesOwned = false;
  try {
    cloneResources(object); resourcesOwned = true;
    object.updateMatrixWorld(true);
    const basis = DIRECTIONS[direction].map(values => new THREE.Vector3(...values));
    const faces = [], nodes = [], min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    let skipped = 0, transparentOccluders = false;
    const v = new THREE.Vector3(), local = new THREE.Vector3();
    object.traverseVisible(node => {
      if (!node.isMesh || node.userData.cappReferenceProjection) return;
      requireValue(!node.isSkinnedMesh && !node.isInstancedMesh && !Object.keys(node.geometry.morphAttributes || {}).length, 'Reference projection currently supports static meshes; bake skinning, instances and morph targets first.');
      const geometry = node.geometry, position = geometry.getAttribute('position'), index = geometry.index;
      if (!position) return;
      const count = index ? index.count : position.count;
      requireValue(count%3 === 0, 'Reference projection requires triangle geometry.');
      requireValue(Math.abs(node.matrixWorld.determinant()) > 1e-18, 'Apply a non-zero scale before projecting a reference.');
      const owner = {node, faces:[], orientation:Math.sign(node.matrixWorld.determinant())}; nodes.push(owner);
      const start = Math.max(0, geometry.drawRange.start), end = Math.min(count,start+geometry.drawRange.count);
      for (let offset = start; offset+2 < end; offset += 3) {
        const material = faceMaterial(geometry,node.material,offset);
        if (!material || material.visible === false || material.opacity === 0) continue;
        if (material.transparent || material.alphaTest > 0 || material.alphaMap) transparentOccluders = true;
        const points = [], ids = [];
        for (let k = 0; k < 3; k++) {
          const id = index ? index.getX(offset+k) : offset+k;
          local.fromBufferAttribute(position,id); ids.push(id);
          v.copy(local).applyMatrix4(node.matrixWorld);
          const point = basis.map(axis => v.dot(axis));
          requireValue(point.every(Number.isFinite), 'The model contains invalid vertex positions.');
          points.push(point);
          for (let n = 0; n < 3; n++) { min[n] = Math.min(min[n],point[n]); max[n] = Math.max(max[n],point[n]); }
        }
        const face = {id:faces.length, points, ids, owner, material}; faces.push(face); owner.faces.push(face);
      }
    });
    requireValue(faces.length > 0, 'There are no visible triangles to project onto.');
    const width = max[0]-min[0], height = max[1]-min[1], diagonal = Math.hypot(width,height,max[2]-min[2]);
    requireValue(width > 1e-12 && height > 1e-12 && diagonal < 1e12, 'Choose a direction that shows the surface rather than its edge.');
    const aspect = decoded.canvas.width/decoded.canvas.height;
    requireValue([widthScale,heightScale].every(v=>Number.isFinite(v)&&v>=.01&&v<=100),'Use positive image width and height.');
    const baseWidth=Math.max(width,height*aspect)*scale,imageWidth=baseWidth*widthScale,imageHeight=baseWidth/aspect*heightScale;
    const centreX = (max[0]+min[0])/2, centreY = (max[1]+min[1])/2;
    const depth = new Float32Array(SIZE*SIZE); depth.fill(-Infinity);
    const owners = new Int32Array(SIZE*SIZE); owners.fill(-1);
    let samples = 0;
    for (const face of faces) {
      const p = face.points.map(([x,y,z]) => [(x-min[0])/width*(SIZE-1),(y-min[1])/height*(SIZE-1),z]); 
      const [a,b,c] = p, area = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); face.area = area;
      if (Math.abs(area) < 1e-12) continue;
      const lowX = Math.max(0,Math.ceil(Math.min(a[0],b[0],c[0]))), highX = Math.min(SIZE-1,Math.floor(Math.max(a[0],b[0],c[0])));
      const lowY = Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1]))), highY = Math.min(SIZE-1,Math.floor(Math.max(a[1],b[1],c[1])));
      samples += Math.max(0,highX-lowX+1)*Math.max(0,highY-lowY+1);
      requireValue(samples <= MAX_RASTER_SAMPLES, 'This model has too many overlapping surfaces for reference projection. Isolate a component or reduce its mesh first.');
      for (let y = lowY; y <= highY; y++) for (let x = lowX; x <= highX; x++) {
        const wb = ((x-a[0])*(c[1]-a[1])-(y-a[1])*(c[0]-a[0]))/area;
        const wc = ((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/area, wa = 1-wb-wc;
        if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
        const z = wa*a[2]+wb*b[2]+wc*c[2], pixel = y*SIZE+x;
        if (z > depth[pixel]) { depth[pixel] = z; owners[pixel] = face.id; }
      }
      if (face.id%4096 === 4095) await tick();
    }
    let paintedTriangles = 0;
    const texture = new THREE.CanvasTexture(decoded.canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.name = 'Projected reference image'; texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    const material = new THREE.MeshStandardMaterial({map:texture,roughness:.85,metalness:0,alphaTest:.025,side:THREE.FrontSide});
    material.name = 'Reference image projection'; material.userData.cappReferenceProjection = true;
    for (const owner of nodes) {
      const positions = [], normals = [], uvs = [];
      const normalAttribute = owner.node.geometry.getAttribute('normal');
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(owner.node.matrixWorld), inverseLinear = new THREE.Matrix3().setFromMatrix4(owner.node.matrixWorld).invert();
      for (const face of owner.faces) {
        if (face.area*owner.orientation <= 1e-10) continue;
        const p = face.points.map(([x,y,z]) => [(x-min[0])/width*(SIZE-1),(y-min[1])/height*(SIZE-1),z]), x = Math.round((p[0][0]+p[1][0]+p[2][0])/3), y = Math.round((p[0][1]+p[1][1]+p[2][1])/3), pixel = y*SIZE+x;
        // Compare at the depth-buffer sample, not at the exact centroid, so a
        // sloped triangle does not incorrectly occlude itself after rounding.
        const [a,b,c] = p;
        const wb = ((x-a[0])*(c[1]-a[1])-(y-a[1])*(c[0]-a[0]))/face.area;
        const wc = ((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))/face.area;
        const z = a[2]+wb*(b[2]-a[2])+wc*(c[2]-a[2]);
        if (owners[pixel] !== face.id && depth[pixel] > z+diagonal*1e-5) continue;
        const uv = face.points.map(point => {
          let u = (point[0]-centreX)/imageWidth+.5-offsetX;
          if (flipX) u = 1-u;
          return [u,(point[1]-centreY)/imageHeight+.5-offsetY];
        });
        // Keep boundary triangles on their original material rather than
        // smearing clamped border texels or painting outside the source image.
        if (uv.some(value => value.some(n => n < -1e-7 || n > 1+1e-7))) { skipped++; continue; }
        const locals=face.ids.map(id=>new THREE.Vector3().fromBufferAttribute(owner.node.geometry.attributes.position,id));
        const faceNormal = new THREE.Vector3().subVectors(locals[1],locals[0]).cross(new THREE.Vector3().subVectors(locals[2],locals[0])).normalize();
        const worldNormal = faceNormal.clone().applyMatrix3(normalMatrix).normalize();
        const delta = worldNormal.multiplyScalar(diagonal*2e-5).applyMatrix3(inverseLinear);
        for (let k = 0; k < 3; k++) {
          const point = locals[k].clone().add(delta); positions.push(point.x,point.y,point.z);
          const normal = normalAttribute ? new THREE.Vector3().fromBufferAttribute(normalAttribute,face.ids[k]).normalize() : faceNormal;
          normals.push(normal.x,normal.y,normal.z); uvs.push(Math.max(0,Math.min(1,uv[k][0])),Math.max(0,Math.min(1,uv[k][1])));
        }
        paintedTriangles++;
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3)); geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const overlay = new THREE.Mesh(geometry,material); overlay.name = `${owner.node.name || 'Surface'} · reference projection`;
      overlay.userData.cappReferenceProjection = {direction,scale,offsetX,offsetY,flipX:Boolean(flipX),visibility:'512px triangle-centre depth approximation'};
      owner.node.add(overlay);
    }
    if (!paintedTriangles) { texture.dispose(); material.dispose(); throw new Error('No faces can receive this projection. Check the direction, image scale and offsets.'); }
    const warnings = ['Reference projection uses approximate visibility at triangle centres (512px depth map). Thin edges and partly hidden triangles may need cleanup.', `The source image is a surface overlay (${paintedTriangles.toLocaleString()} extra triangles). Hidden surfaces and transparent pixels retain their original material; this does not generate unseen textures.`];
    if (skipped) warnings.push(`${skipped.toLocaleString()} boundary triangles were left unchanged because they extend outside the image. Enlarge or realign the projection to cover them.`);
    if (transparentOccluders) warnings.push('Visibility treats existing transparent surfaces as solid occluders. Hidden faces behind glass or earlier image overlays may remain unpainted.');
    if (decoded.reduced) warnings.push('The projection texture was resized to a maximum of 2048 pixels per side.');
    return {object,paintedTriangles,warnings};
  } catch (error) { if (resourcesOwned) disposeResources(object); throw error; }
}
