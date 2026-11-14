import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {chartGeometry,mappedGeometry,applyMaterial,applyTexture,clearTexture,textureImage} from '../src/builder-materials.mjs';
import {bakeSourceTextures} from '../src/builder-texture-bake.mjs';

// Geometry and resource checks use a bounded raster double. Browser coverage
// separately exercises real decoding, raster pixels, GLB export and disk reopen.
let closed=0,transparentCentre=false;
globalThis.createImageBitmap=async()=>({width:128,height:128,close(){closed++;}});
globalThis.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>({drawImage(){},fillRect(){},getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);for(let i=3;i<data.length;i+=4)data[i]=255;if(transparentCentre)for(let y=32;y<96;y++)for(let x=32;x<96;x++)data[(y*canvas.width+x)*4+3]=0;return {data};}});return canvas;}};
const header=new Uint8Array(24),dv=new DataView(header.buffer);dv.setUint32(0,0x89504e47);dv.setUint32(4,0x0d0a1a0a);header.set(new TextEncoder().encode('IHDR'),12);dv.setUint32(16,128);dv.setUint32(20,128);
const blob=new Blob([header],{type:'image/png'}),refs={front:{blob}},settings={colour:'#c0e8ef',roughness:.25,metalness:.8,opacity:.3,transmission:1,ior:1.45,thickness:.02};
const triangles=g=>{const p=g.attributes.position,index=g.index,out=[];for(let i=0;i<(index?.count??p.count);i+=3){const triangle=[];for(let k=0;k<3;k++){const id=index?index.getX(i+k):i+k;triangle.push(p.getX(id),p.getY(id),p.getZ(id));}out.push(JSON.stringify(triangle));}return out.sort();};
const plane=(z=0)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshStandardMaterial({color:0x123456}));m.position.z=z;return m;};
let count=0;const test=async(name,fn)=>{await fn();console.log('PASS '+name);count++;};

await test('UV seams preserve exact triangles, normals, normalized attributes and existing maps',async()=>{
 const g=new THREE.PlaneGeometry(2,2),before=triangles(g);g.setAttribute('colour',new THREE.Uint8BufferAttribute([0,64,255,255,128,0,128,255,64,64,0,128],3,true));
 const result=await chartGeometry(g,new Int8Array([0,1]),(id,c)=>[c,id/4],'uv1');
 assert.equal(result.attributes.position.count,6);assert.deepEqual(triangles(result),before);assert.deepEqual(result.groups,g.groups);
 for(let i=0;i<result.attributes.position.count;i++){const p=result.attributes.position,source=Array.from({length:4},(_,j)=>j).find(j=>g.attributes.position.getX(j)===p.getX(i)&&g.attributes.position.getY(j)===p.getY(i));assert.equal(result.attributes.colour.getY(i),g.attributes.colour.getY(source));assert.equal(result.attributes.uv.getY(i),g.attributes.uv.getY(source));assert.equal(result.attributes.normal.getZ(i),1);}
});
await test('generated meshes without UVs receive bounded box UVs without changing triangles',async()=>{
 const m=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());m.geometry.deleteAttribute('uv');const before=triangles(m.geometry),g=await mappedGeometry(m,'box');assert.deepEqual(triangles(g),before);assert.ok(g.attributes.uv.array.every(v=>v>=0&&v<=1));await assert.rejects(()=>mappedGeometry(m,'existing'),/no UVs/);
});
await test('glass uses physical transmission while retaining texture and normal maps',()=>{
 const m=plane(),base=new THREE.Texture(),normal=new THREE.Texture();m.material.map=base;m.material.normalMap=normal;applyMaterial(m,settings);assert.ok(m.material.isMeshPhysicalMaterial);assert.equal(m.material.map,base);assert.equal(m.material.normalMap,normal);assert.equal(m.material.transmission,1);assert.equal(m.material.ior,1.45);assert.equal(m.material.thickness,.02);assert.equal(m.material.opacity,1);assert.equal(m.material.metalness,0);assert.equal(m.material.defines.PHYSICAL,'');assert.equal(m.material.transparent,false);
 applyMaterial(m,{...settings,transmission:0});assert.equal(m.material.opacity,.3);assert.equal(m.material.transparent,true);assert.throws(()=>applyMaterial(m,{...settings,ior:Infinity}),/IOR/);
});
await test('map slots preserve unrelated channels, colour space and texture transforms',async()=>{
 const m=plane(),image=await textureImage(blob);await applyTexture(m,image,{slot:'colour',mapping:'existing',repeatX:3,repeatY:2,rotation:90});const colour=m.material.map;assert.equal(colour.colorSpace,THREE.SRGBColorSpace);assert.deepEqual(colour.repeat.toArray(),[3,2]);assert.equal(colour.rotation,Math.PI/2);
 await applyTexture(m,image,{slot:'normal'});assert.equal(m.material.map,colour);assert.equal(m.material.normalMap.colorSpace,THREE.NoColorSpace);applyMaterial(m,settings);assert.equal(m.material.map,colour);assert.ok(m.material.normalMap);clearTexture(m,'normal');assert.equal(m.material.normalMap,null);assert.equal(m.material.map,colour);
 await assert.rejects(()=>textureImage(new Blob(['<svg/>'],{type:'image/svg+xml'})),/PNG/);await assert.rejects(()=>textureImage(new Blob(['invalid'],{type:'image/png'})),/header/);
});
await test('source baking respects selection and occlusion, preserving existing UV maps and every triangle',async()=>{
 const root=new THREE.Group(),front=plane(1),back=plane(0);front.material.normalMap=new THREE.Texture();root.add(front,back);const before=triangles(front.geometry),backMaterial=back.material,oldGeometry=front.geometry;
 const result=await bakeSourceTextures(root,[front,back],refs,{atlasSize:1024});assert.equal(result.painted,2);assert.equal(result.unchanged,2);assert.equal(back.material,backMaterial);assert.deepEqual(triangles(front.geometry),before);for(let i=0;i<front.geometry.attributes.position.count;i++){const pos=front.geometry.attributes.position,j=Array.from({length:4},(_,n)=>n).find(n=>oldGeometry.attributes.position.getX(n)===pos.getX(i)&&oldGeometry.attributes.position.getY(n)===pos.getY(i));assert.equal(front.geometry.attributes.uv.getX(i),oldGeometry.attributes.uv.getX(j));assert.equal(front.geometry.attributes.uv.getY(i),oldGeometry.attributes.uv.getY(j));}assert.equal(front.material[0].map.channel,1);assert.ok(front.material[0].normalMap);assert.equal(front.material[0].normalMap.channel,0);assert.equal(front.geometry.attributes.uv1.count,4);assert.equal(root.children.length,2);
 const hiddenMaterial=front.material;await assert.rejects(()=>bakeSourceTextures(root,[back],refs,{atlasSize:1024}),/No faces/);assert.equal(front.material,hiddenMaterial);
});
await test('all six reference directions select the expected outward faces, including mirrored transforms',async()=>{
 const rotations={front:[0,0,0],back:[0,Math.PI,0],right:[0,Math.PI/2,0],left:[0,-Math.PI/2,0],top:[-Math.PI/2,0,0],bottom:[Math.PI/2,0,0]};
 for(const [name,r] of Object.entries(rotations)){const m=plane();m.rotation.set(...r);m.scale.x=-1;const result=await bakeSourceTextures(m,[m],{[name]:{blob}},{atlasSize:1024});assert.equal(result.painted,2,name);}
});
await test('multiview atlas covers distinct faces without overlay triangles or repeated UV channels',async()=>{
 const m=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshStandardMaterial()),before=triangles(m.geometry);m.geometry.deleteAttribute('uv');
 const references=Object.fromEntries(['front','back','right','left','top','bottom'].map(v=>[v,{blob}]));let result=await bakeSourceTextures(m,[m],references,{atlasSize:1024});assert.equal(result.painted,12);assert.deepEqual(Object.values(result.perView),[2,2,2,2,2,2]);assert.deepEqual(triangles(m.geometry),before);assert.equal(m.material.length,1);assert.equal(m.material[0].map.channel,0);
 result=await bakeSourceTextures(m,[m],references,{atlasSize:1024});assert.equal(result.painted,12);assert.equal(m.geometry.attributes.uv1,undefined);assert.equal(m.material.length,1);assert.deepEqual(triangles(m.geometry),before);
 m.material[0].normalMap=new THREE.Texture();m.material[0].normalMap.channel=0;await bakeSourceTextures(m,[m],references,{atlasSize:1024});assert.equal(m.material[0].map.channel,1);assert.equal(m.material[0].normalMap.channel,0);assert.deepEqual(triangles(m.geometry),before);
});
await test('unsafe or cancelled bakes reject before changing the scene',async()=>{
 const m=plane(),g=m.geometry,mat=m.material;await assert.rejects(()=>bakeSourceTextures(m,[m],refs,{signal:AbortSignal.abort()}),/cancelled/);assert.equal(m.geometry,g);assert.equal(m.material,mat);m.userData.builderLocked=true;await assert.rejects(()=>bakeSourceTextures(m,[m],refs),/unlocked/);m.userData.builderLocked=false;await assert.rejects(()=>bakeSourceTextures(m,[m],refs,{offsetX:100}),/offsets/);m.geometry.morphAttributes.position=[g.attributes.position];await assert.rejects(()=>bakeSourceTextures(m,[m],refs),/static/);
});
await test('transparent source regions keep existing materials instead of projecting fallback colour',async()=>{transparentCentre=true;const m=plane(),g=m.geometry,material=m.material;try{await assert.rejects(()=>bakeSourceTextures(m,[m],refs,{atlasSize:1024}),/No faces/);assert.equal(m.geometry,g);assert.equal(m.material,material);}finally{transparentCentre=false;}});
assert.ok(closed>0);console.log(count+' material and source-bake checks passed. Real pixel/export coverage is separate.');
