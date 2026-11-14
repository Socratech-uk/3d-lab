/** Static, independently owned mesh output from portable Shape Lab recipes. */
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {buildShapeGeometry} from './authoring/src/model-format/sol-shape-profile.js';
import {normalizeShapePart, normalizeShapeDocument, normalizeShapeSketch} from './shape-document.mjs';
export const MAX_SHAPE_TRIANGLES=500000;
const countTriangles=g=>(g.index?.count??g.attributes.position.count)/3;
function profileGeometry(recipe){const source=buildShapeGeometry(recipe),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(source.vertices.flat(),3));g.setAttribute('normal',new THREE.Float32BufferAttribute(source.normals.flat(),3));g.setAttribute('uv',new THREE.Float32BufferAttribute(source.uvs.flat(),2));g.setIndex(source.faces.flatMap(f=>f.vertices));return g;}
function removeDegenerates(geometry){
  const p=geometry.attributes.position,source=geometry.index?Array.from(geometry.index.array):Array.from({length:p.count},(_,i)=>i),indices=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<source.length;i+=3){a.fromBufferAttribute(p,source[i]);b.fromBufferAttribute(p,source[i+1]);c.fromBufferAttribute(p,source[i+2]);if(b.sub(a).cross(c.sub(a)).lengthSq()>1e-30)indices.push(source[i],source[i+1],source[i+2]);}
  const used=[...new Set(indices)],map=new Map(used.map((id,i)=>[id,i]));
  if(used.length!==p.count)for(const [name,attr]of Object.entries(geometry.attributes)){const values=new attr.array.constructor(used.length*attr.itemSize);for(let i=0;i<used.length;i++)for(let k=0;k<attr.itemSize;k++)values[i*attr.itemSize+k]=attr.array[used[i]*attr.itemSize+k];geometry.setAttribute(name,new THREE.BufferAttribute(values,attr.itemSize,attr.normalized));}
  geometry.setIndex(used.length===p.count?indices:indices.map(i=>map.get(i)));geometry.clearGroups();return geometry;
}
function checkBevelClearance(points,bevel){
  if(!bevel)return;
  const poly=points.map(p=>({...p})),area=poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p.x*q.y-q.x*p.y;},0);if(area<0)poly.reverse();
  const offsets=poly.map((p,i)=>{const a=poly[(i+poly.length-1)%poly.length],b=poly[(i+1)%poly.length],l=Math.hypot(p.x-a.x,p.y-a.y),r=Math.hypot(b.x-p.x,b.y-p.y),n=[-(p.y-a.y)/l,(p.x-a.x)/l],m=[-(b.y-p.y)/r,(b.x-p.x)/r],den=1+n[0]*m[0]+n[1]*m[1];if(den<1e-10)throw new Error('Bevel cannot fit this very sharp corner. Reduce the bevel or adjust the sketch.');let x=(n[0]+m[0])/den,y=(n[1]+m[1])/den;const norm=Math.hypot(x,y);if(norm>Math.SQRT2){x*=Math.SQRT2/norm;y*=Math.SQRT2/norm;}return{x,y};});
  try{for(let step=1;step<=8;step++){const b=bevel*step/8,pts=poly.map((p,i)=>({x:p.x+offsets[i].x*b,y:p.y+offsets[i].y*b}));normalizeShapeSketch({points:pts,closed:true});const a=pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p.x*q.y-q.x*p.y;},0);if(a<=0)throw new Error('Collapsed inset.');}}
  catch{throw new Error('The bevel overlaps a narrow or sharp part of the sketch. Reduce bevel or widen that section.');}
}
function extrusionGeometry(part){
  const {points}=part.sketch,{depth,bevel,bevelSegments,taper,twist,segments}=part.params;
  checkBevelClearance(points,bevel);
  const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,p.y)));shape.closePath();
  const steps=Math.max(segments,Math.ceil(Math.abs(twist)/10),1),g=new THREE.ExtrudeGeometry(shape,{depth:Math.max(0,depth-2*bevel),steps,curveSegments:1,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelOffset:-bevel,bevelSegments});
  const p=g.attributes.position;
  // Extrude around sketch origin; depth is centred on Z, taper is front/back ratio.
  for(let i=0;i<p.count;i++){
    const z=p.getZ(i)+bevel,progress=Math.min(1,Math.max(0,z/depth)),scale=1+(taper-1)*progress,angle=twist*Math.PI/180*progress,cos=Math.cos(angle),sin=Math.sin(angle),x=p.getX(i)*scale,y=p.getY(i)*scale;
    p.setXYZ(i,x*cos-y*sin,x*sin+y*cos,z-depth/2);
  }
  removeDegenerates(g);g.computeVertexNormals();return g;
}
function revolveGeometry(part){
  // Revolve a closed radius-height contour. Axis edges collapse intentionally;
  // their zero-area quads are omitted, leaving one fan at either end.
  let points=part.sketch.points.map(p=>({...p}));
  const signed=points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0);if(signed<0)points.reverse();
  const segments=part.params.segments,positions=[],normals=[],uvs=[],indices=[];
  const lengths=points.map((p,i)=>{const q=points[(i+1)%points.length];return Math.hypot(q.x-p.x,q.y-p.y);}),total=lengths.reduce((a,b)=>a+b,0);let walked=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],length=lengths[i],nx=(b.y-a.y)/length,ny=-(b.x-a.x)/length,start=positions.length/3;
    if(a.x===0&&b.x===0){walked+=length;continue;}
    for(let j=0;j<=segments;j++){
      const theta=(j===segments?0:j/segments)*Math.PI*2,c=Math.cos(theta),s=Math.sin(theta);
      for(const [p,v] of [[a,walked/total],[b,(walked+length)/total]]){positions.push(p.x*c,p.y,p.x*s);normals.push(nx*c,ny,nx*s);uvs.push(j/segments,v);}
    }
    for(let j=0;j<segments;j++){
      const a0=start+j*2,b0=a0+1,a1=a0+2,b1=a0+3;
      if(a.x>0)indices.push(a0,b0,a1);if(b.x>0)indices.push(b0,b1,a1);
    }
    walked+=length;
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);return g;
}
function bakeTransform(g,transform){
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation.map(n=>n*Math.PI/180),'XYZ')),matrix=new THREE.Matrix4().compose(new THREE.Vector3(...transform.position),q,new THREE.Vector3(...transform.scale));g.applyMatrix4(matrix);
  if(matrix.determinant()<0){const ix=g.index;if(ix){for(let i=0;i<ix.count;i+=3){const b=ix.getX(i+1);ix.setX(i+1,ix.getX(i+2));ix.setX(i+2,b);}ix.needsUpdate=true;}else for(const attr of Object.values(g.attributes))for(let i=0;i<attr.count;i+=3)for(let c=0;c<attr.itemSize;c++){const a=(i+1)*attr.itemSize+c,b=(i+2)*attr.itemSize+c,t=attr.array[a];attr.array[a]=attr.array[b];attr.array[b]=t;}}
}
function ensureFacingNormals(g){
  const p=g.attributes.position,n=g.attributes.normal,ix=Array.from(g.index.array),changes=[],a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3();
  for(let i=0;i<ix.length;i+=3){a.fromBufferAttribute(p,ix[i]);b.fromBufferAttribute(p,ix[i+1]);c.fromBufferAttribute(p,ix[i+2]);const face=b.sub(a).cross(c.sub(a)).normalize();if([0,1,2].some(k=>face.dot(normal.fromBufferAttribute(n,ix[i+k]))< -1e-7))changes.push({offset:i,face:face.toArray()});}
  if(!changes.length)return;
  const attrs={};for(const [name,attr]of Object.entries(g.attributes))attrs[name]=Array.from(attr.array);
  for(const {offset,face}of changes)for(let k=0;k<3;k++){const id=ix[offset+k],next=attrs.position.length/3;for(const [name,attr]of Object.entries(g.attributes)){if(name==='normal')attrs[name].push(...face);else for(let c=0;c<attr.itemSize;c++)attrs[name].push(attr.array[id*attr.itemSize+c]);}ix[offset+k]=next;}
  for(const [name,attr]of Object.entries(g.attributes))g.setAttribute(name,new THREE.BufferAttribute(new attr.array.constructor(attrs[name]),attr.itemSize,attr.normalized));g.setIndex(ix);
}
function validateGeometry(g){
  const count=countTriangles(g);if(!Number.isInteger(count)||count<1||count>MAX_SHAPE_TRIANGLES)throw new Error(`Shape Lab supports 1–${MAX_SHAPE_TRIANGLES.toLocaleString('en-US')} triangles per scene. Reduce resolution or remove a part.`);
  for(const [name,attr]of Object.entries(g.attributes))if(attr.count!==g.attributes.position.count||!attr.array.every(Number.isFinite))throw new Error(`Shape ${name} data is invalid. Reduce the parameters and try again.`);
  const p=g.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();for(let i=0;i<g.index.count;i+=3){a.fromBufferAttribute(p,g.index.getX(i));b.fromBufferAttribute(p,g.index.getX(i+1));c.fromBufferAttribute(p,g.index.getX(i+2));if(b.sub(a).cross(c.sub(a)).lengthSq()<1e-30)throw new Error('This transform is too small or too far from the origin for an accurate mesh. Increase scale or move closer to the origin.');}
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}
export function buildShapePart(input){
  const part=normalizeShapePart(input);let geometry;
  try{geometry=part.type==='profile'?profileGeometry(part.profile):part.type==='extrude'?extrusionGeometry(part):revolveGeometry(part);removeDegenerates(geometry);bakeTransform(geometry,part.transform);ensureFacingNormals(geometry);validateGeometry(geometry);
    const material=new THREE.MeshStandardMaterial({color:part.color,roughness:.68,metalness:.05}),mesh=new THREE.Mesh(geometry,material);mesh.name=part.name;mesh.visible=part.visible;mesh.userData={shapePartId:part.id,cappShapePart:part,builderId:part.id,builderLocked:part.locked,builderHidden:!part.visible};return mesh;
  }catch(error){geometry?.dispose();throw error;}
}
export function buildShapeScene(input){
  const document=normalizeShapeDocument(input),scene=new THREE.Group();scene.name=document.title;scene.userData.cappShapeDocument=document;let triangles=0;
  try{for(const part of document.parts){const mesh=buildShapePart(part);scene.add(mesh);triangles+=countTriangles(mesh.geometry);if(triangles>MAX_SHAPE_TRIANGLES)throw new Error('This Shape Lab scene exceeds 500,000 triangles. Reduce resolution or remove parts.');}scene.userData.shapeTriangleCount=triangles;return scene;}
  catch(error){scene.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}});throw error;}
}
