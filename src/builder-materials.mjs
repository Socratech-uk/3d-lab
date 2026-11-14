import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check, imageDimensions} from './core.mjs';

export const PROJECTION_AXES = Object.freeze({front:[0,1,1,1,2,1],back:[0,-1,1,1,2,-1],right:[2,-1,1,1,0,1],left:[2,1,1,1,0,-1],top:[0,1,2,-1,1,1],bottom:[0,1,2,1,1,-1]});
export const MAP_SLOTS = Object.freeze({colour:'map',normal:'normalMap',roughness:'roughnessMap',metalness:'metalnessMap'});
const get = ['getX','getY','getZ','getW'], set = ['setX','setY','setZ','setW'];
export const pause = () => new Promise(resolve=>setTimeout(resolve,0));
export function canvasOf(width,height) {const c=typeof document!=='undefined'?document.createElement('canvas'):new OffscreenCanvas(width,height);c.width=width;c.height=height;return c;}

/** Decode once to owned immutable pixels. No paths, URLs or SVG execution. */
export async function textureImage(blob, {size=2048}={}) {
  check(blob instanceof Blob && blob.size>0 && blob.size<=25*1024**2,'Choose a PNG, JPEG or WEBP texture up to 25 MiB.');
  check(['image/png','image/jpeg','image/webp'].includes(blob.type),'Textures accept PNG, JPEG or WEBP.');
  const dims=imageDimensions(new Uint8Array(await blob.arrayBuffer()),blob.type);
  check(dims.width>0 && dims.height>0 && dims.width*dims.height<=24_000_000,'Use a texture up to 24 megapixels.');
  const bitmap=await createImageBitmap(blob);
  try {
    const scale=Math.min(1,size/Math.max(bitmap.width,bitmap.height)),canvas=canvasOf(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale))),ctx=canvas.getContext('2d',{willReadFrequently:true});
    check(ctx,'Image processing is unavailable.');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>4){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
    check(x1>=x0 && y1>=y0,'The image is completely transparent.');
    return {canvas,name:String(blob.name||'Texture image').slice(0,200),crop:[x0,y0,x1-x0+1,y1-y0+1],reduced:scale<1};
  } finally {bitmap.close();}
}

export function staticGeometry(mesh) {
  const g=mesh.geometry,p=g?.attributes?.position;
  check(mesh.isMesh && !mesh.isSkinnedMesh && !mesh.isInstancedMesh && !Object.values(g?.morphAttributes||{}).some(a=>a.length),'Texture authoring currently supports static mesh parts.');
  check(p?.itemSize===3 && (g.index?.count??p.count)%3===0,'Texture mapping needs complete triangles.');
  return g;
}

/** Indexed chart seams only: triangle order, positions and all unrelated attributes
 * survive. Each chart may assign a different UV to a shared source vertex. */
export async function chartGeometry(geometry, charts, uvForVertex, uvName='uv') {
  const p=geometry.attributes.position,index=geometry.index,count=index?.count??p.count;
  check(charts.length===count/3,'Texture chart count does not match the mesh.');
  const keys=[...new Set(charts)],maps=new Map(keys.map(k=>[k,new Int32Array(p.count).fill(-1)]));
  const ids=[],chartIds=[],outputIndex=new Uint32Array(count);
  for(let i=0;i<count;i++) {
    const source=index?index.getX(i):i,chart=charts[Math.floor(i/3)],map=maps.get(chart);
    check(Number.isInteger(source)&&source>=0&&source<p.count,'The mesh has an invalid index.');
    let target=map[source];if(target<0){target=ids.length;map[source]=target;ids.push(source);chartIds.push(chart);}outputIndex[i]=target;
    if(i%196608===196607)await pause();
  }
  const out=new THREE.BufferGeometry();
  for(const [name,a] of Object.entries(geometry.attributes)) {
    // Changed UVs invalidate tangent directions. The renderer derives them from UVs.
    if(name===uvName||name==='tangent')continue;
    check(a.itemSize>=1&&a.itemSize<=4&&a.count===p.count,'Unsupported texture vertex attribute: '+name);
    const ctor=(a.isInterleavedBufferAttribute?a.data.array:a.array).constructor,copy=new THREE.BufferAttribute(new ctor(ids.length*a.itemSize),a.itemSize,a.normalized);
    for(let i=0;i<ids.length;i++)for(let c=0;c<a.itemSize;c++)copy[set[c]](i,a[get[c]](ids[i]));
    out.setAttribute(name,copy);await pause();
  }
  const uv=new Float32Array(ids.length*2);
  for(let i=0;i<ids.length;i++) {const coords=uvForVertex(ids[i],chartIds[i]);check(coords.length===2&&coords.every(Number.isFinite),'Texture mapping produced invalid coordinates.');uv[i*2]=coords[0];uv[i*2+1]=coords[1];}
  out.setAttribute(uvName,new THREE.BufferAttribute(uv,2));out.setIndex(new THREE.BufferAttribute(outputIndex,1));
  out.groups=geometry.groups.map(g=>({...g}));out.setDrawRange(geometry.drawRange.start,geometry.drawRange.count);out.userData=JSON.parse(JSON.stringify(geometry.userData||{}));
  out.computeBoundingBox();out.computeBoundingSphere();return out;
}

export async function mappedGeometry(mesh, mode='existing') {
  const g=staticGeometry(mesh),p=g.attributes.position,index=g.index;
  if(mode==='existing'){check(g.attributes.uv,'This part has no UVs. Choose Box or a planar mapping.');return null;}
  check(mode==='box'||PROJECTION_AXES[mode],'Choose existing UVs, Box or a planar direction.');
  const dirs=Object.keys(PROJECTION_AXES),charts=new Int8Array((index?.count??p.count)/3),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  const box=new THREE.Box3().setFromBufferAttribute(p),min=box.min.toArray(),max=box.max.toArray();
  for(let f=0;f<charts.length;f++) {
    if(mode!=='box'){charts[f]=dirs.indexOf(mode);continue;}
    a.fromBufferAttribute(p,index?index.getX(f*3):f*3);b.fromBufferAttribute(p,index?index.getX(f*3+1):f*3+1);c.fromBufferAttribute(p,index?index.getX(f*3+2):f*3+2);
    normal.subVectors(b,a).cross(c.sub(a));const n=normal.toArray(),axis=[0,1,2].reduce((best,i)=>Math.abs(n[i])>Math.abs(n[best])?i:best,0);
    charts[f]=axis===2?(n[axis]>=0?0:1):axis===0?(n[axis]>=0?2:3):(n[axis]>=0?4:5);
    if(f%65536===65535)await pause();
  }
  return chartGeometry(g,charts,(id,chart)=>{const axis=PROJECTION_AXES[dirs[chart]],xyz=[p.getX(id),p.getY(id),p.getZ(id)];return [[axis[0],axis[1]],[axis[2],axis[3]]].map(([i,sign])=>{const q=(xyz[i]-min[i])/Math.max(max[i]-min[i],1e-12);return sign>0?q:1-q;});});
}

export function materialSettings(value) {
  check(/^#[0-9a-f]{6}$/i.test(value.colour),'Choose a valid material colour.');
  for(const key of ['roughness','metalness','opacity','transmission'])check(Number.isFinite(value[key])&&value[key]>=0&&value[key]<=1,'Use '+key+' between 0 and 1.');
  check(Number.isFinite(value.ior)&&value.ior>=1&&value.ior<=2.333,'Use a glass IOR from 1 to 2.333.');
  check(Number.isFinite(value.thickness)&&value.thickness>=0&&value.thickness<=100000,'Use a non-negative glass thickness.');
  return value;
}

function physicalCopy(source) {
  if(source.isMeshPhysicalMaterial)return source.clone();
  const target=new THREE.MeshPhysicalMaterial();
  if(source.isMeshStandardMaterial)THREE.MeshStandardMaterial.prototype.copy.call(target,source);
  else {target.color.copy(source.color||new THREE.Color('white'));target.map=source.map||null;target.transparent=source.transparent;target.opacity=source.opacity;target.side=source.side;target.vertexColors=source.vertexColors;}
  // StandardMaterial.copy replaces shader defines; restore physical shader support.
  target.defines={STANDARD:'',PHYSICAL:''};return target;
}

export function applyMaterial(mesh, value) {
  materialSettings(value);staticGeometry(mesh);
  const old=[mesh.material].flat(),materials=old.map(source=>{
    const m=physicalCopy(source);m.name=value.name||source.name||'Builder material';m.color.set(value.colour);m.roughness=value.roughness;m.metalness=value.transmission>0?0:value.metalness;
    m.transmission=value.transmission;m.ior=value.ior;m.thickness=value.thickness;m.opacity=value.transmission>0?1:value.opacity;m.transparent=m.opacity<1;m.depthWrite=!m.transparent;m.side=THREE.DoubleSide;
    m.needsUpdate=true;return m;
  });
  mesh.material=Array.isArray(mesh.material)?materials:materials[0];for(const m of old)m.dispose();
}

export async function applyTexture(mesh, image, options={}) {
  const {slot='colour',mapping='existing',repeatX=1,repeatY=1,rotation=0}=options;
  check(MAP_SLOTS[slot],'Choose a supported texture channel.');
  check([repeatX,repeatY].every(n=>Number.isFinite(n)&&n>=.01&&n<=100)&&Number.isFinite(rotation)&&Math.abs(rotation)<=360,'Use repeat 0.01–100 and rotation −360–360 degrees.');
  const geometry=await mappedGeometry(mesh,mapping);
  const texture=new THREE.CanvasTexture(image.canvas);texture.name=image.name;texture.colorSpace=slot==='colour'?THREE.SRGBColorSpace:THREE.NoColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(repeatX,repeatY);texture.center.set(.5,.5);texture.rotation=rotation*Math.PI/180;
  const old=[mesh.material].flat(),materials=old.map(source=>{const m=physicalCopy(source);m[MAP_SLOTS[slot]]=texture;if(slot==='colour'){m.color.set(0xffffff);m.vertexColors=false;}if(slot==='roughness')m.roughness=1;if(slot==='metalness')m.metalness=1;m.needsUpdate=true;return m;});
  if(geometry){mesh.geometry.dispose();mesh.geometry=geometry;}
  mesh.material=Array.isArray(mesh.material)?materials:materials[0];
  const retained=new Set(materials.flatMap(m=>Object.values(m).filter(v=>v?.isTexture)));
  for(const m of old){for(const v of Object.values(m))if(v?.isTexture&&!retained.has(v))v.dispose();m.dispose();}
  mesh.userData.builderTexture={slot,mapping,repeatX,repeatY,rotation};
}

export function clearTexture(mesh,slot) {
  check(MAP_SLOTS[slot],'Choose a supported texture channel.');
  const old=[mesh.material].flat(),materials=old.map(source=>{const m=source.clone();m[MAP_SLOTS[slot]]=null;m.needsUpdate=true;return m;});
  const keep=new Set(materials.flatMap(m=>Object.values(m).filter(v=>v?.isTexture)));
  mesh.material=Array.isArray(mesh.material)?materials:materials[0];
  for(const m of old){for(const v of Object.values(m))if(v?.isTexture&&!keep.has(v))v.dispose();m.dispose();}
}
