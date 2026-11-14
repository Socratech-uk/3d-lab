import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {projectReference} from '../src/builder-projection.mjs';

// The geometry checks run without WebGL. This decoder/canvas double exercises
// exported texture ownership; real image decoding and GLB image export need the
// browser checks, not this test double.
let imageWidth = 128, imageHeight = 128, closed = 0;
globalThis.createImageBitmap = async () => ({width:imageWidth,height:imageHeight,close(){closed++;}});
globalThis.document = {createElement(name) { assert.equal(name,'canvas'); return {width:0,height:0,getContext(type){assert.equal(type,'2d');return{drawImage(){}};}};}};
const reference = new Blob(['test decoder fixture'],{type:'image/png'});
let count = 0;
const test = async (name,fn) => {await fn();count++;console.log('PASS',name);};
const overlays = object => {const found=[];object.traverse(node => {if(node.isMesh && node.userData.cappReferenceProjection)found.push(node);});return found;};
function plane(name,z=0,material=new THREE.MeshStandardMaterial({color:0x123456})) {const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);mesh.name=name;mesh.position.z=z;return mesh;}

await test('occluded surfaces and original materials survive an independently owned edit',async()=>{
  const object = new THREE.Group(), front=plane('Front',1), back=plane('Back',0); object.add(front,back);
  const originalPositions=front.geometry.attributes.position.array.slice(), originalUv=front.geometry.attributes.uv.array.slice();
  const result=await projectReference(object,reference);
  assert.equal(result.paintedTriangles,2); assert.equal(overlays(result.object).length,1);
  assert.equal(overlays(result.object)[0].parent.name,'Front');
  assert.equal(front.children.length,0); assert.deepEqual(front.geometry.attributes.position.array,originalPositions); assert.deepEqual(front.geometry.attributes.uv.array,originalUv);
  assert.notEqual(result.object.children[0].geometry,front.geometry); assert.notEqual(result.object.children[0].material,front.material);
  assert.equal(result.object.children[1].material.color.getHex(),back.material.color.getHex());
  const overlay=overlays(result.object)[0];assert.ok(overlay.material.map.isCanvasTexture);assert.equal(overlay.material.map.colorSpace,THREE.SRGBColorSpace);assert.ok(overlay.material.alphaTest>0);
  assert.equal(overlay.geometry.attributes.uv.count,6);assert.ok(overlay.geometry.attributes.position.getZ(0)>0);
  assert.ok(result.warnings.some(text=>text.includes('triangle centres')));assert.ok(result.warnings.some(text=>text.includes('extra triangles')));
});
await test('multi-material groups, textures and source images are independent after cloning',async()=>{
  const a=new THREE.MeshStandardMaterial({color:0x112233}),b=new THREE.MeshStandardMaterial({color:0x998877});
  a.map=new THREE.Texture({width:4,height:4});const mesh=plane('Materials',0,[a,b]);mesh.geometry.clearGroups();mesh.geometry.addGroup(0,3,0);mesh.geometry.addGroup(3,3,1);
  const {object}=await projectReference(mesh,reference);assert.equal(object.material.length,2);assert.notEqual(object.material[0].map,a.map);assert.notEqual(object.material[0].map.image,a.map.image);
  assert.deepEqual(object.geometry.groups,mesh.geometry.groups);assert.equal(object.material[1].color.getHex(),b.color.getHex());
  object.material[0].color.set(0xffffff);assert.equal(a.color.getHex(),0x112233);
});
await test('source aspect ratio and explicit horizontal flip are baked into UVs',async()=>{
  imageWidth=256;imageHeight=128;
  const first=await projectReference(plane('Aspect'),reference),flipped=await projectReference(plane('Aspect'),reference,{flipX:true});
  const uv=overlays(first.object)[0].geometry.attributes.uv,flip=overlays(flipped.object)[0].geometry.attributes.uv;
  assert.equal(Math.min(...uv.array.filter((_,i)=>i%2===0)),.25);assert.equal(Math.max(...uv.array.filter((_,i)=>i%2===0)),.75);
  for(let i=0;i<uv.count;i++){assert.equal(flip.getX(i),1-uv.getX(i));assert.equal(flip.getY(i),uv.getY(i));}
  imageWidth=imageHeight=128;
});
await test('all six cardinal directions select the intended facing surfaces',async()=>{
  const rotations={front:[0,0,0],back:[0,Math.PI,0],right:[0,Math.PI/2,0],left:[0,-Math.PI/2,0],top:[-Math.PI/2,0,0],bottom:[Math.PI/2,0,0]};
  for(const [direction,rotation] of Object.entries(rotations)){const mesh=plane(direction);mesh.rotation.set(...rotation);const result=await projectReference(mesh,reference,{direction});assert.equal(result.paintedTriangles,2,direction);}
});
await test('negative object scale retains outward-facing projection',async()=>{
  const mesh=plane('Mirrored');mesh.scale.x=-1;const result=await projectReference(mesh,reference);assert.equal(result.paintedTriangles,2);
});
await test('transformed parent hierarchy participates in shared scene occlusion',async()=>{
  const scene=new THREE.Group(),near=new THREE.Group(),far=new THREE.Group();near.position.z=2;far.position.z=-1;near.add(plane('Near'));far.add(plane('Far'));scene.add(near,far);scene.rotation.z=.2;
  const result=await projectReference(scene,reference);assert.equal(result.paintedTriangles,2);assert.equal(overlays(result.object)[0].parent.name,'Near');
});
await test('no image edge smearing, no invalid options and no dynamic mesh edits',async()=>{
  const mesh=plane('Bounds');await assert.rejects(()=>projectReference(mesh,reference,{scale:.5}),/No faces/);assert.equal(mesh.children.length,0);
  await assert.rejects(()=>projectReference(mesh,reference,{offsetX:100}),/offsets/);await assert.rejects(()=>projectReference(mesh,reference,{direction:'diagonal'}),/Choose/);
  await assert.rejects(()=>projectReference(mesh,new Blob(['x'],{type:'image/svg+xml'})),/PNG/);
  mesh.geometry.morphAttributes.position=[mesh.geometry.attributes.position.clone()];await assert.rejects(()=>projectReference(mesh,reference),/static meshes/);
});
await test('transparent occluders and hidden objects have explicit behaviour',async()=>{
  const group=new THREE.Group(),glass=plane('Glass',1),hull=plane('Hull');glass.material.transparent=true;glass.material.opacity=.5;group.add(glass,hull);
  const result=await projectReference(group,reference);assert.equal(result.paintedTriangles,2);assert.ok(result.warnings.some(text=>text.includes('solid occluders')));
  glass.visible=false;const second=await projectReference(group,reference);assert.equal(overlays(second.object)[0].parent.name,'Hull');
});
await test('56k triangle ship-size workload completes with bounded output',async()=>{
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,170,166),new THREE.MeshStandardMaterial());
  const before=performance.now(),result=await projectReference(mesh,reference);const elapsed=performance.now()-before;
  assert.ok(result.paintedTriangles>5000);assert.ok(result.paintedTriangles<mesh.geometry.index.count/3);assert.ok(elapsed<10000,`Projection took ${elapsed.toFixed(0)}ms`);
  console.log(`  ${mesh.geometry.index.count/3} input triangles, ${result.paintedTriangles} overlay triangles, ${elapsed.toFixed(0)}ms`);
});
assert.ok(closed>0);console.log(`${count} reference-projection checks passed. Browser decoding/GLB export is a separate check.`);
