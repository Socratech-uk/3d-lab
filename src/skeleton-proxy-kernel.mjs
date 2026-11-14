import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {cleanupGeometry,simplifyGeometry} from './builder-geometry.mjs';

export const PROXY_LIMITS=Object.freeze({vertices:20000,triangles:40000});
export function predictionProxy(mesh,progress=()=>{}) {
 const {positions,indices}=mesh;
 if(!positions?.length||positions.length%3||!indices?.length||indices.length%3)throw new Error('Skeleton prediction needs complete XYZ vertices and triangles.');
 for(const v of positions)if(!Number.isFinite(v)||Math.abs(v)>1e6)throw new Error('The mesh contains invalid coordinates.');
 for(const i of indices)if(!Number.isInteger(i)||i<0||i>=positions.length/3)throw new Error('The mesh contains invalid triangle indices.');
 const before={vertices:positions.length/3,triangles:indices.length/3};
 let geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(Array.from(indices));
 try {
  // Positions only: the inference copy does not need UV seams, normals or skin
  // weights. No attribute, transform or vertex in the author's mesh is modified.
  progress('Welding the prediction copy; the detailed model is retained.',.12);
  let next=cleanupGeometry(geometry);geometry.dispose();geometry=next;
  let previous=Infinity;
  for(let pass=0;pass<4;pass++) {
   const vertices=geometry.attributes.position.count,triangles=geometry.index.count/3;
   if(vertices<=PROXY_LIMITS.vertices&&triangles<=PROXY_LIMITS.triangles)break;
   if(triangles>=previous)throw new Error('Protected borders prevented a usable prediction copy. Your model is unchanged. Repair or reduce a copy in Builder first.');
   previous=triangles;
   progress('Simplifying a temporary copy for skeleton prediction…',.2+pass*.17);
   const ratio=Math.max(.02,Math.min(.8,16000/vertices,32000/triangles));
   next=simplifyGeometry(geometry,ratio,{preserveSharpEdges:false}).geometry;geometry.dispose();geometry=next;
  }
  const after={vertices:geometry.attributes.position.count,triangles:geometry.index.count/3};
  if(after.vertices>PROXY_LIMITS.vertices||after.triangles>PROXY_LIMITS.triangles)throw new Error('The protected mesh could not be reduced to the prediction limit. Your detailed model is unchanged.');
  const result={positions:Array.from(geometry.attributes.position.array),indices:Array.from(geometry.index.array)};
  if(new TextEncoder().encode(JSON.stringify({mesh:result})).length>12*1024**2-4096)throw new Error('The prediction copy exceeds the engine request limit. The original model is unchanged.');
  progress(`Prediction copy ready: ${after.vertices.toLocaleString()} vertices · ${after.triangles.toLocaleString()} triangles.`,1);
  return {mesh:result,preparation:{before,after,simplified:after.vertices<before.vertices||after.triangles<before.triangles,method:'Constrained quadric-error edge collapse; position-only copy'}};
 } finally {geometry.dispose();}
}
