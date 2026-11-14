import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {inspectGlb, LIMITS, encode64, digest} from '../src/core.mjs';
import {ModelWorkshop} from '../src/workshop.mjs';
import {ModelLibrary} from '../src/library.mjs';
import {transformComponent, mergeComponents, disposeComponent} from '../src/builder-objects.mjs';
import {cleanupGeometry} from '../src/builder-geometry.mjs';
import {predictionProxy} from '../src/skeleton-proxy-kernel.mjs';
import {skeletonReadiness} from '../src/action-composer.mjs';
import {packGlb} from './fixtures.mjs';
import {indexedDB} from 'fake-indexeddb';

let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
function fixture(vertices,triangles,extraAccessors=0) {
 const positions=new Float32Array(vertices*3),indices=new Uint32Array(triangles*3);
 for(let i=0;i<vertices;i++)positions.set(i%3===1?[1,0,0]:i%3===2?[0,1,0]:[0,0,0],i*3);
 for(let i=0;i<indices.length;i++)indices[i]=i%3;
 const binary=new Uint8Array(positions.byteLength+indices.byteLength);
 binary.set(new Uint8Array(positions.buffer));binary.set(new Uint8Array(indices.buffer),positions.byteLength);
 const position={bufferView:0,componentType:5126,count:vertices,type:'VEC3',min:[0,0,0],max:[1,1,0]};
 const json={asset:{version:'2.0',generator:'Synthetic mesh-count regression'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:binary.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],accessors:[position,{bufferView:1,componentType:5125,count:indices.length,type:'SCALAR'},...Array.from({length:extraAccessors},()=>({...position}))]};
 return {bytes:packGlb(json,binary),positions,indices,json,binary};
}
const highTriangles=fixture(3,2_000_001);
await test('GLB admission accepts over two million triangles and six million indices',()=>{
 const result=inspectGlb(highTriangles.bytes);assert.equal(result.triangles,2_000_001);assert.equal(result.vertices,3);assert.ok(result.byteLength<LIMITS.glbBytes);
});
const highVertices=fixture(2_000_001,1,8);
await test('GLB admission accepts over two million vertices without a secondary attribute-count cap',()=>{
 const result=inspectGlb(highVertices.bytes);assert.equal(result.vertices,2_000_001);assert.equal(result.triangles,1);
});
await test('buffer extents and complete triangles remain validated above old count caps',()=>{
 const bad=structuredClone(highVertices.json);bad.accessors[0].count++;
 assert.throws(()=>inspectGlb(packGlb(bad,highVertices.binary)),/exceeds its buffer/);
 const incomplete=structuredClone(highTriangles.json);incomplete.accessors[1].count--;
 assert.throws(()=>inspectGlb(packGlb(incomplete,highTriangles.binary)),/triangle indices/);
});
await test('large generated output is saved and reopened byte-for-byte with requested Hunyuan controls',async()=>{
 const library=new ModelLibrary({indexedDB,name:'mesh-counts-'+crypto.randomUUID()});
 try {
  const settings={model:'hunyuan3d-2mv',device:'cuda',resolution:512,steps:75,seed:19,guidanceScale:5.5,numChunks:4000,memoryMode:'cpu-offload'};
  const workshop=new ModelWorkshop({render:async()=>({...settings,modelGlb:encode64(highTriangles.bytes)})},library);
  const source={blob:new Blob(['controlled-reference']),imagePng:'Zml4dHVyZQ==',sha256:'f'.repeat(64),name:'front.png',width:64,height:64};
  source.views={left:{...source,name:'left.png'}};
  const saved=await workshop.generate({source,settings,info:{title:'Above former mesh caps'}});
  library.close();const record=await library.get(saved.asset.id);
  assert.equal(record.asset.triangles,2_000_001);assert.deepEqual(record.asset.recipe,settings);
  assert.equal(await digest(new Uint8Array(await record.files.glb.arrayBuffer())),await digest(highTriangles.bytes));
 } finally {library.close();}
});
const mesh=()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(highTriangles.positions,3));g.setIndex(new THREE.BufferAttribute(highTriangles.indices,1));return new THREE.Mesh(g,new THREE.MeshStandardMaterial());};
await test('Builder component transforms and merges accept meshes above the old scene ceiling',()=>{
 const source=mesh(),small=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());let transformed,merged;
 try {transformed=transformComponent(source);assert.equal(transformed.geometry.index.count,6_000_003);merged=mergeComponents([source,small]);assert.equal(merged.geometry.index.count/3,2_000_013);assert.equal(source.geometry.index.count,6_000_003);}
 finally {for(const obj of [source,small,transformed,merged])if(obj)disposeComponent(obj);}
});
await test('cleanup and prediction preparation accept a detailed source above two million vertices',()=>{
 const before=highVertices.positions.slice(),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(highVertices.positions,3));g.setIndex(new THREE.BufferAttribute(highVertices.indices,1));
 try {const clean=cleanupGeometry(g);assert.equal(clean.attributes.position.count,3);clean.dispose();}finally{g.dispose();}
 const result=predictionProxy({positions:highVertices.positions,indices:highVertices.indices});
 assert.equal(result.preparation.before.vertices,2_000_001);assert.equal(result.preparation.after.vertices,3);assert.equal(result.preparation.after.triangles,1);assert.deepEqual(highVertices.positions,before);
 assert.deepEqual(skeletonReadiness({loaded:true,licenseAccepted:true,seed:0,device:'cuda',meshStats:{vertices:2_000_001,triangles:4_000_000}}),[]);
});
console.log(`${count} mesh-count checks passed. Synthetic geometry and controlled engine replies; no inference or performance acceptance.`);
