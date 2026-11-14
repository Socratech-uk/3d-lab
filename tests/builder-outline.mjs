import assert from 'node:assert/strict';
import { BoxGeometry, SphereGeometry, PlaneGeometry, BufferGeometry, Float32BufferAttribute } from '../vendor/three-0.160.1/build/three.module.js';
import { splitOutlineGeometry } from '../src/builder-outline.mjs';
import { shellGeometry, surfaceTopology } from '../src/builder-solids.mjs';

let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const close=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`);
const square=[[-.4,-.3,1],[.4,-.3,1],[.4,.3,1],[-.4,.3,1]];
const options={points:square,minDepth:.5,maxDepth:1.1};
const cube=new BoxGeometry(2,2,2);
const closed=g=>{const t=surfaceTopology(g);assert.equal(t.boundaryEdges,0);assert.equal(t.nonManifoldEdges,0);assert.equal(t.inconsistentEdges,0);assert.equal(t.degenerateTriangles,0);assert.ok(t.signedVolume>0);return t;};
const area=g=>{const p=g.getAttribute('position'),idx=g.index;let sum=0;for(let i=0;i<(idx?.count??p.count);i+=3){const a=[0,1,2].map(k=>{const id=idx?idx.getX(i+k):i+k;return [p.getX(id),p.getY(id),p.getZ(id)];}),u=a[1].map((n,k)=>n-a[0][k]),v=a[2].map((n,k)=>n-a[0][k]);sum+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}return sum;};
const original=JSON.stringify(cube.toJSON());

await test('a bounded outline separates an exact solid plug and complementary remainder',()=>{
  const result=splitOutlineGeometry(cube,options),inside=closed(result.inside),outside=closed(result.outside);
  close(inside.signedVolume,.8*.6*.5);close(inside.signedVolume+outside.signedVolume,8);
  assert.ok(result.metrics.capTriangles>0);assert.equal(result.metrics.capped,true);
  assert.equal(JSON.stringify(cube.toJSON()),original,'Source positions, attributes, indices, groups and metadata are immutable.');
});
await test('surface-panel mode cuts actual triangle boundaries and retains all exterior area',()=>{
  const result=splitOutlineGeometry(cube,{...options,cap:false});
  close(area(result.inside),.8*.6);close(area(result.outside)+area(result.inside),24);
  assert.equal(result.metrics.capped,false);assert.equal(result.metrics.capTriangles,0);
  assert.ok(surfaceTopology(result.inside).boundaryEdges>=4);assert.ok(surfaceTopology(result.outside).boundaryEdges>=4);
  assert.ok(result.warnings.some(w=>w.includes('open cut')));
  const p=result.inside.getAttribute('position');for(let i=0;i<p.count;i++){assert.ok(p.getX(i)>=-.400001&&p.getX(i)<=.400001);assert.ok(p.getY(i)>=-.300001&&p.getY(i)<=.300001);close(p.getZ(i),1);}
});
await test('cut before wall generation produces closed window reveals and a separate thick panel',()=>{
  const result=splitOutlineGeometry(cube,{...options,cap:false});
  const hull=shellGeometry(result.outside,{thickness:.08}),panel=shellGeometry(result.inside,{thickness:.08});
  closed(hull.geometry);closed(panel.geometry);assert.ok(hull.rimTriangles>=8);assert.ok(panel.rimTriangles>=8);
});
await test('cut after wall generation closes both skins around the window',()=>{
  const shell=shellGeometry(cube,{thickness:.1}),before=JSON.stringify(shell.geometry.toJSON()),result=splitOutlineGeometry(shell.geometry,options);
  const a=closed(result.inside),b=closed(result.outside);close(a.signedVolume,.8*.6*.1);close(a.signedVolume+b.signedVolume,8-1.8**3);
  assert.equal(JSON.stringify(shell.geometry.toJSON()),before);
});
await test('concave L outline retains its notch and conserves volume',()=>{
  const points=[[-.6,-.5,1],[.6,-.5,1],[.6,0,1],[0,0,1],[0,.5,1],[-.6,.5,1]],result=splitOutlineGeometry(cube,{...options,points});
  close(closed(result.inside).signedVolume,.45);close(closed(result.outside).signedVolume,7.55);
  const p=result.inside.getAttribute('position');for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;assert.ok(!(x>1e-6&&y>1e-6),'The concave notch remains outside the extracted object.');}
});
await test('through-all cuts separate front and back surfaces as one scene part',()=>{
  const result=splitOutlineGeometry(cube,{points:square});close(closed(result.inside).signedVolume,.8*.6*2);close(closed(result.outside).signedVolume,8-.8*.6*2);
  close(result.inside.boundingBox.min.z,-1);close(result.inside.boundingBox.max.z,1);
});
await test('clockwise and explicitly closed loops produce the same cut',()=>{
  const clockwise=splitOutlineGeometry(cube,{...options,points:square.slice().reverse()}),closedLoop=splitOutlineGeometry(cube,{...options,points:[...square,square[0]]});
  close(closed(clockwise.inside).signedVolume,.24);close(closed(closedLoop.inside).signedVolume,.24);
});
await test('view-plane orientation and origin are honoured in model coordinates',()=>{
  const u=[0,0,-1],v=[0,1,0],normal=[1,0,0],origin=[.2,.1,.3],points=square.map(([x,y])=>[1,y+.1,-x+.3]);
  const result=splitOutlineGeometry(cube,{u,v,normal,origin,points,minDepth:.3,maxDepth:1.1});
  close(closed(result.inside).signedVolume,.24);close(result.inside.boundingBox.min.x,.5);close(result.inside.boundingBox.max.x,1);
});
await test('open sources remain open with explicit feedback and can receive walls later',()=>{
  const result=splitOutlineGeometry(new PlaneGeometry(2,2),{points:square});assert.equal(result.metrics.capped,false);assert.ok(result.warnings.some(w=>w.includes('source has open')));
  close(area(result.inside),.48);closed(shellGeometry(result.inside,{thickness:.05}).geometry);closed(shellGeometry(result.outside,{thickness:.05}).geometry);
});
await test('interpolated colours, UVs, smooth normals and material groups survive separation',()=>{
  const g=cube.clone(),p=g.getAttribute('position'),values=[];for(let i=0;i<p.count;i++) values.push((p.getX(i)+1)/2,(p.getY(i)+1)/2,(p.getZ(i)+1)/2);g.setAttribute('color',new Float32BufferAttribute(values,3));
  const result=splitOutlineGeometry(g,{...options,cap:false});
  for(const output of [result.inside,result.outside]) {const p=output.getAttribute('position'),c=output.getAttribute('color'),n=output.getAttribute('normal');assert.equal(output.getAttribute('uv').count,p.count);assert.equal(output.groups.reduce((sum,g)=>sum+g.count,0),p.count);for(let i=0;i<p.count;i++){close(c.getX(i),(p.getX(i)+1)/2);close(c.getY(i),(p.getY(i)+1)/2);close(c.getZ(i),(p.getZ(i)+1)/2);close(Math.hypot(n.getX(i),n.getY(i),n.getZ(i)),1);}}
  assert.ok(result.outside.groups.some(g=>g.materialIndex===5));
});
await test('snapping an outline onto existing mesh edges does not leave false holes',()=>{
  const g=new SphereGeometry(1,48,24),result=splitOutlineGeometry(g,{points:[[0,0,1],[.3,0,1],[.3,.3,1],[0,.3,1]],minDepth:.5,maxDepth:1.1});closed(result.inside);closed(result.outside);
});
await test('curved wall skins produce proper cap rings rather than filling the ship interior',()=>{
  const g=shellGeometry(new SphereGeometry(1,48,24),{thickness:.08}).geometry,result=splitOutlineGeometry(g,{points:[[-.25,-.25,1],[.25,-.25,1],[.25,.25,1],[-.25,.25,1]],minDepth:.5,maxDepth:1.1});
  const a=closed(result.inside),b=closed(result.outside);assert.ok(a.signedVolume>.019&&a.signedVolume<.023);close(a.signedVolume+b.signedVolume,surfaceTopology(g).signedVolume);
});
await test('a second independent window can be cut after the first cut and wall generation',()=>{
  const first=splitOutlineGeometry(cube,{points:[[-.7,-.3,1],[-.3,-.3,1],[-.3,.3,1],[-.7,.3,1]],minDepth:.5,maxDepth:1.1,cap:false});
  const hull=shellGeometry(first.outside,{thickness:.07}).geometry;
  const second=splitOutlineGeometry(hull,{points:[[.3,-.3,1],[.7,-.3,1],[.7,.3,1],[.3,.3,1]],minDepth:.5,maxDepth:1.1});closed(second.outside);closed(second.inside);
});
await test('invalid crossing, degenerate and oversized outlines are rejected without mutation',()=>{
  for(const points of [[[0,0,1],[.5,.5,1],[0,.5,1],[.5,0,1]],[[0,0,1],[0,0,1],[.5,.5,1]],[[0,0,1],[.2,0,1],[.4,0,1]],Array.from({length:65},(_,i)=>[Math.cos(i),Math.sin(i),1])]) assert.throws(()=>splitOutlineGeometry(cube,{points}),/outline|points/i);
  assert.equal(JSON.stringify(cube.toJSON()),original);
});
await test('missed outlines, invalid depth and inverted view frames are rejected',()=>{
  assert.throws(()=>splitOutlineGeometry(cube,{points:square.map(p=>[p[0]+10,p[1],p[2]])}),/intersect/);
  assert.throws(()=>splitOutlineGeometry(cube,{...options,minDepth:1,maxDepth:.5}),/positive depth/);
  assert.throws(()=>splitOutlineGeometry(cube,{...options,v:[0,-1,0]}),/right-handed/);
  assert.throws(()=>splitOutlineGeometry(cube,{...options,origin:[NaN,0,0]}),/finite/);
});
await test('unsupported skinning and non-manifold parts fail before replacing a mesh',()=>{
  const g=cube.clone();g.setAttribute('skinIndex',new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count*4),4));assert.throws(()=>splitOutlineGeometry(g,options),/skinning/);
  const bad=new BufferGeometry();bad.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0, 1,0,0,0,0,0,0,-1,0, 0,0,0,1,0,0,0,0,1],3));assert.throws(()=>splitOutlineGeometry(bad,options),/non-manifold/);
});
await test('56k-triangle generated-mesh scale remains closed and numerically conservative',()=>{
  const g=new SphereGeometry(1,240,120),started=performance.now(),result=splitOutlineGeometry(g,{points:[[-.3,-.3,1],[.31,-.3,1],[.31,.3,1],[-.3,.3,1]],minDepth:.5,maxDepth:1.1});
  const a=closed(result.inside),b=closed(result.outside);close(a.signedVolume+b.signedVolume,surfaceTopology(g).signedVolume,2e-5);
  assert.ok(result.metrics.sourceTriangles>56000);console.log(`DENSE outline split and topology verification: ${Math.round(performance.now()-started)} ms`);
});
console.log(`${count} outline separation checks passed.`);
