import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { BoxGeometry, PlaneGeometry, BufferGeometry, Float32BufferAttribute, BufferAttribute } from '../vendor/three-0.160.1/build/three.module.js';
import {cutBoxGeometry,shellGeometry,surfaceTopology} from '../src/builder-solids.mjs';

let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const close=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const cube=new BoxGeometry(2,2,2);
const snapshot=Array.from(cube.getAttribute('position').array);
let cut,shell;
await test('cube positional topology welds face shading and UV seams',()=>{
  const topology=surfaceTopology(cube);assert.equal(topology.vertices,8);assert.equal(topology.boundaryEdges,0);assert.equal(topology.nonManifoldEdges,0);assert.equal(topology.inconsistentEdges,0);close(topology.signedVolume,8);
});
await test('window clips triangles at the box boundary and removes exact area',()=>{
  cut=cutBoxGeometry(cube,{min:[-.3,-.4,-2],max:[.3,.4,2]});
  close(cut.removedArea,.6*.8*2);assert.ok(cut.clippedTriangles>=4);assert.ok(cut.boundaryEdges>=8);assert.equal(cut.nonManifoldEdges,0);
  for(let i=0;i<cut.geometry.getAttribute('position').count;i+=3) {
    const p=cut.geometry.getAttribute('position'),centre=[0,1,2].map(k=>(p.array[i*3+k]+p.array[(i+1)*3+k]+p.array[(i+2)*3+k])/3);
    assert.ok(!(centre[0]>-.3+1e-6 && centre[0]<.3-1e-6 && centre[1]>-.4+1e-6 && centre[1]<.4-1e-6),'No triangle centroid remains inside the opening.');
  }
  assert.deepEqual(Array.from(cube.getAttribute('position').array),snapshot,'Cut never changes original positions.');
});
await test('cut retains UVs, normals, material groups and interpolated colours',()=>{
  const coloured=new BoxGeometry(2,2,2),p=coloured.getAttribute('position'),colours=[];
  for(let i=0;i<p.count;i++) colours.push((p.getX(i)+1)/2,(p.getY(i)+1)/2,(p.getZ(i)+1)/2);
  coloured.setAttribute('color',new Float32BufferAttribute(colours,3));
  const result=cutBoxGeometry(coloured,{min:[-.31,-.42,-2],max:[.37,.26,2]}),g=result.geometry,n=g.getAttribute('normal'),c=g.getAttribute('color'),v=g.getAttribute('position');
  assert.equal(g.getAttribute('uv').count,v.count);assert.ok(g.groups.some(group=>group.materialIndex===5));assert.equal(g.groups.reduce((n,g)=>n+g.count,0),v.count);
  for(let i=0;i<v.count;i++) {close(c.getX(i),(v.getX(i)+1)/2);close(c.getY(i),(v.getY(i)+1)/2);close(c.getZ(i),(v.getZ(i)+1)/2);close(Math.hypot(n.getX(i),n.getY(i),n.getZ(i)),1);}
});
await test('cut followed by shell produces closed walls and window reveals',()=>{
  shell=shellGeometry(cut.geometry,{thickness:.1});
  assert.equal(shell.rimTriangles,cut.boundaryEdges*2);const t=surfaceTopology(shell.geometry);
  assert.equal(t.boundaryEdges,0);assert.equal(t.nonManifoldEdges,0);assert.equal(t.inconsistentEdges,0);assert.ok(t.signedVolume>0);
  assert.deepEqual(Array.from(cube.getAttribute('position').array),snapshot);
});
await test('closed cube shell offsets corners to exact interior planes',()=>{
  const result=shellGeometry(cube,{thickness:.1}),p=result.geometry.getAttribute('position');
  assert.equal(result.rimTriangles,0);assert.equal(result.triangles,24);
  // Exterior is retained first. Each inner cube coordinate must be ±0.9.
  for(let i=36;i<p.count;i++) for(let k=0;k<3;k++) close(Math.abs(p.array[i*3+k]),.9);
  close(surfaceTopology(result.geometry).signedVolume,8-1.8**3);
});
await test('an open surface receives correctly oriented boundary rims',()=>{
  const plane=new PlaneGeometry(2,2),result=shellGeometry(plane,{thickness:.1}),t=surfaceTopology(result.geometry);
  assert.equal(result.boundaryEdges,4);assert.equal(result.rimTriangles,8);assert.equal(t.boundaryEdges,0);assert.equal(t.inconsistentEdges,0);close(t.signedVolume,.4);
});
await test('doorway crossing a hull edge retains a closed wall shell',()=>{
  const doorway=cutBoxGeometry(new BoxGeometry(2,2,2,4,4,4),{min:[-.33,-2,.5],max:[.41,.6,2]});
  const walls=shellGeometry(doorway.geometry,{thickness:.06}),t=surfaceTopology(walls.geometry);
  assert.equal(t.boundaryEdges,0);assert.equal(t.nonManifoldEdges,0);assert.equal(t.inconsistentEdges,0);
});
await test('off-centre cuts have no false T junctions on untouched neighbours',()=>{
  const cases=[{min:[-.47,-.81,.7],max:[-.21,-.62,2]},{min:[.1,-.13,-2],max:[.76,.24,2]},{min:[-.8,.11,-.8],max:[2,.42,2]}];
  for(const box of cases) {
    const cut=cutBoxGeometry(new BoxGeometry(2,2,2,3,3,3),box),walls=shellGeometry(cut.geometry,{thickness:.02}),t=surfaceTopology(walls.geometry);
    assert.equal(t.boundaryEdges,0);assert.equal(t.nonManifoldEdges,0);assert.equal(t.inconsistentEdges,0);
  }
});
await test('empty, missed, invalid and over-thick operations are rejected',()=>{
  assert.throws(()=>cutBoxGeometry(cube,{min:[-2,-2,-2],max:[2,2,2]}),/entire/);
  assert.throws(()=>cutBoxGeometry(cube,{min:[3,3,3],max:[4,4,4]}),/does not remove/);
  assert.throws(()=>cutBoxGeometry(cube,{min:[0,0,0],max:[0,1,1]}),/positive/);
  assert.throws(()=>cutBoxGeometry(cube,{min:[NaN,0,0],max:[1,1,1]}),/finite/);
  assert.throws(()=>shellGeometry(cube,{thickness:.6}),/quarter/);
  assert.throws(()=>shellGeometry(cube,{thickness:0}),/positive/);
});
await test('non-manifold meshes and inconsistent orientation are rejected',()=>{
  const bad=new BufferGeometry();bad.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0, 1,0,0,0,0,0,0,-1,0, 0,0,0,1,0,0,0,0,1],3));
  assert.throws(()=>shellGeometry(bad,{thickness:.05}),/non-manifold/);
  const inconsistent=new PlaneGeometry(2,2),indices=Array.from(inconsistent.index.array);[indices[3],indices[4]]=[indices[4],indices[3]];inconsistent.setIndex(indices);
  assert.throws(()=>shellGeometry(inconsistent,{thickness:.05}),/winding/);
});
await test('animated attributes are rejected without mutating the source',()=>{
  const skin=cube.clone();skin.setAttribute('skinIndex',new Float32BufferAttribute(new Float32Array(skin.getAttribute('position').count*4),4));
  assert.throws(()=>cutBoxGeometry(skin,{min:[-.3,-.4,-2],max:[.3,.4,2]}),/skin/);
});
await test('adaptive wall thickness reports thinning around a deep generated fold',()=>{
  const dented=new BoxGeometry(2,2,2,8,8,8),p=dented.getAttribute('position');
  for(let i=0;i<p.count;i++) if(Math.abs(p.getX(i))<1e-6 && Math.abs(p.getY(i))<1e-6 && p.getZ(i)>.99) p.setZ(i,.2);
  const result=shellGeometry(dented,{thickness:.3}),t=surfaceTopology(result.geometry);
  assert.ok(result.reducedVertices>0);assert.ok(result.minimumThickness>0 && result.minimumThickness<.3);assert.ok(result.minimumOffset>0);
  assert.equal(t.boundaryEdges,0);assert.equal(t.nonManifoldEdges,0);assert.equal(t.inconsistentEdges,0);assert.equal(t.degenerateTriangles,0);
  assert.ok(result.warnings.some(w=>w.includes('Minimum local offset')));
  assert.throws(()=>shellGeometry(dented,{thickness:.3,adaptive:false}),/fold|thickness/i);
  // Each interior triangle reverses its original exterior triangle and retains
  // a positive area and facing after the output's Float32 conversion.
  const out=result.geometry.getAttribute('position');
  assert.ok(Array.from(out.array).every(Number.isFinite));
  const areaVector=(offset)=>{
    const a=[out.getX(offset),out.getY(offset),out.getZ(offset)],b=[out.getX(offset+1),out.getY(offset+1),out.getZ(offset+1)],c=[out.getX(offset+2),out.getY(offset+2),out.getZ(offset+2)],u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);
    return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  };
  const outerCount=dented.index.count;
  for(let i=0;i<outerCount;i+=3) {const a=areaVector(i),b=areaVector(outerCount+i);assert.ok(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]<0,'Inner triangle faces opposite the exterior without a foldover.');}
});

// Optional real-user GLB check is read-only and does not ship any user asset.
if(process.env.BUILDER_SHIP_GLB) {
  const buffer=await fs.readFile(process.env.BUILDER_SHIP_GLB),jsonLength=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+jsonLength).toString('utf8')),binOffset=20+jsonLength+8;
  const dataView=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength),components={5121:['getUint8',1],5123:['getUint16',2],5125:['getUint32',4],5126:['getFloat32',4]},sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
  function attribute(index) {
    const a=json.accessors[index],v=json.bufferViews[a.bufferView],[method,bytes]=components[a.componentType],size=sizes[a.type],values=new Float32Array(a.count*size),base=binOffset+(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||size*bytes;
    for(let i=0;i<a.count;i++) for(let k=0;k<size;k++) values[i*size+k]=dataView[method](base+i*stride+k*bytes,true);
    return new BufferAttribute(values,size,a.normalized||false);
  }
  for(const [meshIndex,mesh] of json.meshes.entries()) for(const primitive of mesh.primitives) {
    const geometry=new BufferGeometry();for(const [name,index] of Object.entries(primitive.attributes)) geometry.setAttribute({POSITION:'position',NORMAL:'normal',COLOR_0:'color',TEXCOORD_0:'uv'}[name]||name,attribute(index));
    if(primitive.indices!==undefined) geometry.setIndex(Array.from(attribute(primitive.indices).array));
    const started=performance.now(),topology=surfaceTopology(geometry);console.log('REAL SHIP topology',meshIndex,JSON.stringify(topology));
    for(const thickness of [.002,.005,.01]) {
      try {const walls=shellGeometry(geometry,{thickness});console.log('REAL SHIP shell',thickness,`${walls.triangles} triangles`,`${Math.round(performance.now()-started)} ms`,JSON.stringify({minimumOffset:walls.minimumOffset,reducedVertices:walls.reducedVertices,sharpVertices:walls.sharpVertices,topology:surfaceTopology(walls.geometry)}));walls.geometry.dispose();}
      catch(error) {console.log('REAL SHIP shell rejected',thickness,error.message);}
    }
    const cutStarted=performance.now(),shipCut=cutBoxGeometry(geometry,{min:[-.2,-.05,-2],max:[.2,.15,2]});
    console.log('REAL SHIP cut',JSON.stringify({triangles:shipCut.triangles,removedArea:shipCut.removedArea,boundaryEdges:shipCut.boundaryEdges,milliseconds:Math.round(performance.now()-cutStarted)}));
    const shipWalls=shellGeometry(shipCut.geometry,{thickness:.005}),shipWallsTopology=surfaceTopology(shipWalls.geometry);
    assert.equal(shipWallsTopology.boundaryEdges,0);assert.equal(shipWallsTopology.nonManifoldEdges,0);assert.equal(shipWallsTopology.inconsistentEdges,0);
    console.log('REAL SHIP cut + shell',JSON.stringify({triangles:shipWalls.triangles,rimTriangles:shipWalls.rimTriangles,minimumOffset:shipWalls.minimumOffset,topology:shipWallsTopology}));
  }
}
console.log(`${count} cutting and shell checks passed.`);
