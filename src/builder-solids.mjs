import { BufferGeometry, Float32BufferAttribute } from '../vendor/three-0.160.1/build/three.module.js';

// Local surface operations, deliberately not a general-purpose Boolean/solid kernel.
// The cutter removes the portion of each triangle inside an axis-aligned box.
// Shell creates an inward offset skin and joins all existing boundary edges.
// Neither operation attempts to repair intersecting or non-manifold source meshes.
const MAX_INPUT_TRIANGLES = 350000;
const MAX_OUTPUT_TRIANGLES = 1200000;
const EPS_FACTOR = 1e-7;
const fail = message => { throw new Error(message); };
const requireValue = (value, message) => { if (!value) fail(message); };
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length = a => Math.hypot(a[0],a[1],a[2]);
const normalise = a => { const n=length(a); return n>1e-20 ? a.map(v=>v/n) : [0,0,0]; };
const position = vertex => vertex.position;
const twiceArea = vertices => length(cross(sub(position(vertices[1]),position(vertices[0])),sub(position(vertices[2]),position(vertices[0]))));
const near = (a,b,epsilon) => Math.abs(a[0]-b[0])<=epsilon && Math.abs(a[1]-b[1])<=epsilon && Math.abs(a[2]-b[2])<=epsilon;

function inputGeometry(geometry,maxTriangles=MAX_INPUT_TRIANGLES) {
  requireValue(geometry?.isBufferGeometry, 'Choose a mesh component first.');
  requireValue(!Object.values(geometry.morphAttributes || {}).some(a=>a.length), 'Apply morph targets before cutting or creating walls.');
  requireValue(!geometry.getAttribute('skinIndex') && !geometry.getAttribute('skinWeight'), 'Detach the skin before cutting or creating walls.');
  const p=geometry.getAttribute('position'), index=geometry.index;
  requireValue(p && p.itemSize===3 && p.count>=3, 'The mesh needs triangle positions.');
  const count=index ? index.count : p.count;
  requireValue(count%3===0 && count/3<=maxTriangles, `This operation supports at most ${maxTriangles.toLocaleString()} triangles per component. Reduce the selected mesh first.`);
  requireValue(geometry.drawRange.start===0 && (!Number.isFinite(geometry.drawRange.count) || geometry.drawRange.count>=count), 'Apply the mesh draw range before editing.');
  const attributes=Object.entries(geometry.attributes).map(([name,attribute])=>{
    requireValue(attribute.count===p.count && attribute.itemSize>=1 && attribute.itemSize<=4, `Unsupported ${name} attribute layout.`);
    return {name, attribute, size:attribute.itemSize};
  });
  const vertices=new Array(p.count), min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<p.count;i++) {
    const vertex={};
    for(const {name,attribute,size} of attributes) {
      const values=[];
      for(let k=0;k<size;k++) { const v=attribute[['getX','getY','getZ','getW'][k]](i); requireValue(Number.isFinite(v),'The mesh contains invalid attribute values.'); values.push(v); }
      vertex[name]=values;
    }
    vertices[i]=vertex;
    for(let k=0;k<3;k++) { min[k]=Math.min(min[k],vertex.position[k]); max[k]=Math.max(max[k],vertex.position[k]); }
  }
  const diagonal=length(sub(max,min));
  requireValue(Number.isFinite(diagonal) && diagonal>1e-12 && diagonal<1e10,'The mesh has invalid dimensions.');
  // Float32 coordinates are welded within this tolerance for topology only;
  // source positions and all original shading/UV seams remain separate attributes.
  const epsilon=Math.max(diagonal*EPS_FACTOR,1e-10);
  const materials=new Int32Array(count/3), assigned=new Uint8Array(count/3);
  for(const group of geometry.groups) {
    requireValue(Number.isInteger(group.start) && Number.isInteger(group.count) && group.start>=0 && group.count>=0 && group.start%3===0 && group.count%3===0 && group.start+group.count<=count,'The mesh has unsupported material groups.');
    requireValue(Number.isInteger(group.materialIndex) && group.materialIndex>=0,'The mesh has an invalid material index.');
    for(let i=group.start/3;i<(group.start+group.count)/3;i++) { requireValue(!assigned[i],'Overlapping material groups must be separated before editing.'); materials[i]=group.materialIndex; assigned[i]=1; }
  }
  const triangles=new Array(count/3);
  for(let i=0;i<count;i+=3) {
    const indices=[];
    for(let k=0;k<3;k++) { const v=index ? index.getX(i+k) : i+k; requireValue(Number.isInteger(v) && v>=0 && v<p.count,'The mesh contains an invalid triangle index.'); indices.push(v); }
    triangles[i/3]={vertices:indices.map(v=>vertices[v]), material:materials[i/3], indices};
  }
  return {geometry,vertices,triangles,attributes,epsilon,min,max,diagonal};
}

function normaliseDirectionAttributes(vertex) {
  if(vertex.normal) vertex.normal=normalise(vertex.normal);
  if(vertex.tangent) { const xyz=normalise(vertex.tangent); vertex.tangent=[...xyz,vertex.tangent[3]<0 ? -1 : 1]; }
  return vertex;
}
function interpolate(a,b,t,attributes) {
  const vertex={};
  for(const {name,size} of attributes) vertex[name]=Array.from({length:size},(_,k)=>a[name][k]+(b[name][k]-a[name][k])*t);
  return normaliseDirectionAttributes(vertex);
}
function cloneVertex(vertex) { return Object.fromEntries(Object.entries(vertex).map(([name,value])=>[name,value.slice()])); }
function centroid(vertices,attributes) {
  const result={};
  for(const {name,size} of attributes) result[name]=Array.from({length:size},(_,k)=>vertices.reduce((sum,v)=>sum+v[name][k],0)/vertices.length);
  return normaliseDirectionAttributes(result);
}

function outputWriter(input) {
  const arrays=Object.fromEntries(input.attributes.map(({name})=>[name,[]])), groups=[];
  let triangles=0,area=0;
  return {
    add(vertices,material) {
      const twice=twiceArea(vertices);
      if(twice<=input.epsilon*input.epsilon*.01) return false;
      requireValue(triangles<MAX_OUTPUT_TRIANGLES,'The operation would produce too many triangles. Reduce the source or use a smaller cutter.');
      const last=groups[groups.length-1];
      if(last?.materialIndex===material) last.count+=3; else groups.push({start:triangles*3,count:3,materialIndex:material});
      for(const vertex of vertices) for(const {name,size} of input.attributes) for(let k=0;k<size;k++) arrays[name].push(vertex[name][k]);
      triangles++;area+=twice/2;return true;
    },
    finish(operation) {
      requireValue(triangles>0,'The operation would remove the entire selected mesh. Reduce or move the cutter.');
      const geometry=new BufferGeometry();
      for(const {name,size} of input.attributes) geometry.setAttribute(name,new Float32BufferAttribute(arrays[name],size));
      if(!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      for(const group of groups) geometry.addGroup(group.start,group.count,group.materialIndex);
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      geometry.userData={...input.geometry.userData,builderSurfaceOperation:operation};
      return {geometry,triangles,area};
    }
  };
}

// A split returns complementary polygons. A plane-coincident polygon belongs
// inside, so grazing cuts never duplicate a surface.
function splitPolygon(polygon,axis,value,sign,input) {
  if(!polygon.length) return {inside:[],outside:[]};
  const inside=[],outside=[];
  const append=(array,vertex)=>{if(!array.length || !near(position(array[array.length-1]),position(vertex),input.epsilon*.01)) array.push(vertex);};
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length], da=(a.position[axis]-value)*sign,db=(b.position[axis]-value)*sign;
    const aInside=da>=0,bInside=db>=0;
    append(aInside ? inside : outside,a);
    if(aInside!==bInside) {
      const crossing=interpolate(a,b,da/(da-db),input.attributes);
      crossing.position[axis]=value;
      append(inside,crossing);append(outside,crossing);
    }
  }
  const clean=polygon=>{if(polygon.length>1 && near(position(polygon[0]),position(polygon[polygon.length-1]),input.epsilon*.01)) polygon.pop();return polygon.length>=3 ? polygon : [];};
  return {inside:clean(inside),outside:clean(outside)};
}

// Later box planes can insert a point in an earlier fragment's edge. Insert
// that point in both fragments before triangulation to avoid T junctions.
function conformFragments(fragments,input,extraPoints=[]) {
  const points=extraPoints.slice();
  for(const fragment of fragments) for(const vertex of fragment) if(!points.some(v=>near(v.position,vertex.position,input.epsilon*.01))) points.push(vertex);
  return fragments.map(polygon=>{
    const output=[];
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length],edge=sub(b.position,a.position),denominator=dot(edge,edge),candidates=[];
      output.push(a);
      for(const v of points) {
        const t=dot(sub(v.position,a.position),edge)/denominator;
        if(t<=1e-8 || t>=1-1e-8) continue;
        const projected=a.position.map((n,k)=>n+edge[k]*t);
        if(near(projected,v.position,input.epsilon*.1)) candidates.push({t,vertex:interpolate(a,b,t,input.attributes)});
      }
      candidates.sort((a,b)=>a.t-b.t);
      for(const candidate of candidates) if(!near(position(output[output.length-1]),candidate.vertex.position,input.epsilon*.01)) output.push(candidate.vertex);
    }
    return output;
  });
}

/** Remove triangle surface inside a local-space box; never mutates the input. */
export function cutBoxGeometry(geometry,{min,max}={}) {
  requireValue(Array.isArray(min) && Array.isArray(max) && min.length===3 && max.length===3 && [...min,...max].every(Number.isFinite),'The cutter needs finite minimum and maximum coordinates.');
  requireValue(min.every((v,k)=>max[k]>v),'The cutter needs positive width, height and depth.');
  const input=inputGeometry(geometry),writer=outputWriter(input);
  requireValue(min.every((v,k)=>max[k]-v>input.epsilon*10),'The cutter is too thin for this mesh scale.');
  const planes=[[0,min[0],1],[0,max[0],-1],[1,min[1],1],[1,max[1],-1],[2,min[2],1],[2,max[2],-1]];
  let clippedTriangles=0,removedTriangles=0,originalArea=0,degenerateTriangles=0;
  const plans=[],edgeCuts=new Map();
  const pointKey=p=>p.map(v=>Math.round(v/input.epsilon)).join(',');
  const edgeKey=(a,b)=>{const ka=pointKey(a.position),kb=pointKey(b.position);return ka<kb ? `${ka}/${kb}` : `${kb}/${ka}`;};
  function registerCuts(original,fragments) {
    for(let k=0;k<3;k++) {
      const a=original[k],b=original[(k+1)%3],edge=sub(b.position,a.position),denominator=dot(edge,edge),key=edgeKey(a,b);
      for(const polygon of fragments) for(const v of polygon) {
        const t=dot(sub(v.position,a.position),edge)/denominator;
        if(t<=1e-8 || t>=1-1e-8) continue;
        const projected=a.position.map((n,d)=>n+edge[d]*t);
        if(near(projected,v.position,input.epsilon*.1)) {
          if(!edgeCuts.has(key)) edgeCuts.set(key,[]);
          if(!edgeCuts.get(key).some(p=>near(p,v.position,input.epsilon*.01))) edgeCuts.get(key).push(v.position);
        }
      }
    }
  }
  for(const triangle of input.triangles) {
    const original=triangle.vertices,area=twiceArea(original)/2;originalArea+=area;
    if(area<=input.epsilon*input.epsilon*.005) {degenerateTriangles++;continue;}
    if([0,1,2].some(k=>original.every(v=>v.position[k]<min[k]) || original.every(v=>v.position[k]>max[k]))) {plans.push({triangle,fragments:[original]});continue;}
    let remainder=original,fragments=[];
    for(const [axis,value,sign] of planes) {
      const split=splitPolygon(remainder,axis,value,sign,input);
      if(split.outside.length) fragments.push(split.outside);
      remainder=split.inside;if(!remainder.length) break;
    }
    let removedArea=0;
    for(let i=1;i<remainder.length-1;i++) removedArea+=twiceArea([remainder[0],remainder[i],remainder[i+1]])/2;
    // A box can touch the triangle or its bounding box without removing area.
    if(removedArea<=input.epsilon*input.epsilon*.01) {plans.push({triangle,fragments:[original]});continue;}
    clippedTriangles++;
    if(!fragments.length) {removedTriangles++;continue;}
    registerCuts(original,fragments);
    plans.push({triangle,fragments});
  }
  requireValue(clippedTriangles>0,'The cutter does not remove any mesh surface. Move it through the hull.');
  // Share edge insertions across source triangles, including neighbours that
  // the box did not remove. This prevents false holes at clipping partitions.
  for(const {triangle,fragments:sourceFragments} of plans) {
    const extra=[];
    for(let k=0;k<3;k++) {
      const a=triangle.vertices[k],b=triangle.vertices[(k+1)%3],points=edgeCuts.get(edgeKey(a,b));
      if(!points) continue;
      const edge=sub(b.position,a.position),denominator=dot(edge,edge);
      for(const p of points) extra.push(interpolate(a,b,dot(sub(p,a.position),edge)/denominator,input.attributes));
    }
    const fragments=conformFragments(sourceFragments,input,extra);
    for(const polygon of fragments) {
      if(polygon.length===3) writer.add(polygon,triangle.material);
      else {const centre=centroid(polygon,input.attributes);for(let i=0;i<polygon.length;i++) writer.add([centre,polygon[i],polygon[(i+1)%polygon.length]],triangle.material);}
    }
  }
  const result=writer.finish('box surface cut'),warnings=['This is an open surface cut. Create walls after cutting to add thickness and opening reveals.'];
  if(degenerateTriangles) warnings.push(`${degenerateTriangles} zero-area source triangles were omitted.`);
  const topology=analyseTopology(inputGeometry(result.geometry,MAX_OUTPUT_TRIANGLES));
  return {...result,originalTriangles:input.triangles.length,clippedTriangles,removedTriangles,removedArea:Math.max(0,originalArea-result.area),boundaryEdges:topology.boundaries.length,nonManifoldEdges:topology.nonManifoldEdges,warnings};
}

function analyseTopology(input) {
  const buckets=new Map(),points=[],vertexIds=new Map(),edges=new Map(),faces=[];
  const epsilon=input.epsilon;
  function id(vertex) {
    if(vertexIds.has(vertex)) return vertexIds.get(vertex);
    const p=vertex.position,cell=p.map(v=>Math.floor(v/epsilon));let found=-1;
    search:for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++) {
      const bucket=buckets.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`);
      if(bucket) for(const candidate of bucket) if(near(points[candidate].position,p,epsilon)) {found=candidate;break search;}
    }
    if(found<0) {
      found=points.length;points.push({position:p,normal:[0,0,0],minDot:1,fallbackNormal:null});
      const key=cell.join(',');if(!buckets.has(key)) buckets.set(key,[]);buckets.get(key).push(found);
    }
    vertexIds.set(vertex,found);return found;
  }
  let degenerateTriangles=0,volume6=0;
  for(const triangle of input.triangles) {
    const ids=triangle.vertices.map(id),v=triangle.vertices.map(position),areaVector=cross(sub(v[1],v[0]),sub(v[2],v[0])),area=length(areaVector);
    if(new Set(ids).size!==3 || area<=epsilon*epsilon*.01) {degenerateTriangles++;continue;}
    const normal=areaVector.map(n=>n/area),face={...triangle,ids,normal};faces.push(face);
    volume6+=dot(v[0],cross(v[1],v[2]));
    for(let k=0;k<3;k++) {
      const a=sub(v[(k+1)%3],v[k]),b=sub(v[(k+2)%3],v[k]),angle=Math.atan2(length(cross(a,b)),dot(a,b)),point=points[ids[k]];
      for(let d=0;d<3;d++) point.normal[d]+=normal[d]*angle;
      if(!point.fallbackNormal) point.fallbackNormal=normal;
      const from=ids[k],to=ids[(k+1)%3],key=from<to ? `${from}:${to}` : `${to}:${from}`;
      if(!edges.has(key)) edges.set(key,[]);
      edges.get(key).push({from,to,a:triangle.vertices[k],b:triangle.vertices[(k+1)%3],material:triangle.material});
    }
  }
  let nonManifoldEdges=0,inconsistentEdges=0;
  const boundaries=[];
  for(const adjacency of edges.values()) {
    if(adjacency.length===1) boundaries.push(adjacency[0]);
    else if(adjacency.length!==2) nonManifoldEdges++;
    else if(adjacency[0].from===adjacency[1].from) inconsistentEdges++;
  }
  for(const point of points) {point.normal=normalise(point.normal);if(length(point.normal)<.5 && point.fallbackNormal) point.normal=point.fallbackNormal.slice();}
  for(const face of faces) for(const index of face.ids) points[index].minDot=Math.min(points[index].minDot,dot(points[index].normal,face.normal));
  return {points,faces,boundaries,nonManifoldEdges,inconsistentEdges,degenerateTriangles,volume:volume6/6};
}

/** Inspect welded positional topology without rewriting shading/material seams. */
export function surfaceTopology(geometry) {
  const input=inputGeometry(geometry),topology=analyseTopology(input);
  return {triangles:topology.faces.length,vertices:topology.points.length,boundaryEdges:topology.boundaries.length,nonManifoldEdges:topology.nonManifoldEdges,inconsistentEdges:topology.inconsistentEdges,degenerateTriangles:topology.degenerateTriangles,signedVolume:topology.volume};
}

/** Inset wall skin with reversed faces and rims at existing boundary edges. */
export function shellGeometry(geometry,{thickness,adaptive=true}={}) {
  requireValue(Number.isFinite(thickness) && thickness>0,'Wall thickness must be a positive number in model units.');
  const input=inputGeometry(geometry),topology=analyseTopology(input),writer=outputWriter(input);
  requireValue(thickness>input.epsilon*10,'Wall thickness is too small for this mesh scale.');
  const nonzeroDimensions=sub(input.max,input.min).filter(d=>d>input.epsilon*10);
  requireValue(thickness<Math.min(...nonzeroDimensions)*.25,'Wall thickness must be less than a quarter of the selected mesh’s smallest dimension.');
  requireValue(!topology.nonManifoldEdges,'This mesh has non-manifold edges. Clean or separate overlapping parts before creating walls.');
  requireValue(!topology.inconsistentEdges,'This mesh has inconsistent triangle winding. Repair its face orientation before creating walls.');
  requireValue(topology.boundaries.length || topology.volume>input.epsilon**3,'The closed mesh faces inward. Flip its face orientation before creating interior walls.');
  let maxOffset=0,sharpVertices=0;
  for(const point of topology.points) {
    if(point.minDot<.5) sharpVertices++;
    requireValue(adaptive || point.minDot>.12,'A sharp fold prevents a stable inward wall offset. Enable adaptive thickness or smooth that area first.');
    requireValue(length(point.normal)>.5,'A collapsed vertex prevents wall generation. Clean or smooth the selected mesh first.');
    // A miter keeps planar corners at the requested thickness; sharp generated
    // folds use a capped normal offset rather than an unbounded spike.
    point.baseOffset=thickness/(point.minDot>.5 ? point.minDot : 1);
    point.factor=1;
    point.inner=point.position.map((v,k)=>v-point.normal[k]*point.baseOffset);
  }
  const inside=(vertex,index)=>{const copy=cloneVertex(vertex);copy.position=topology.points[index].inner.slice();if(copy.normal) copy.normal=copy.normal.map(v=>-v);if(copy.tangent) copy.tangent[3]*=-1;return copy;};
  // Contract only vertices incident to a flipped inner triangle. A generated
  // hull often contains tiny sharp folds that cannot carry uniform thickness.
  // This preserves connectivity and reports the actual minimum local offset.
  let converged=false;
  for(let iteration=0;iteration<24;iteration++) {
    const affected=new Set();
    for(const face of topology.faces) {
      const v=face.ids.map(i=>topology.points[i].inner),n=cross(sub(v[1],v[0]),sub(v[2],v[0]));
      if(length(n)<=input.epsilon**2*.01 || dot(n,face.normal)<=0) for(const id of face.ids) affected.add(id);
    }
    if(!affected.size) {converged=true;break;}
    requireValue(adaptive,'This thickness folds or collapses part of the inner wall. Enable adaptive thickness, reduce it or smooth the mesh first.');
    for(const index of affected) {
      const point=topology.points[index];point.factor*=.5;
      point.inner=point.position.map((v,k)=>v-point.normal[k]*point.baseOffset*point.factor);
    }
  }
  requireValue(converged,'The inner wall still folds at this thickness. Reduce the thickness or smooth the mesh first.');
  let reducedVertices=0,minimumThickness=thickness,minimumOffset=Infinity;
  for(const point of topology.points) {
    if(point.factor<1) reducedVertices++;
    minimumThickness=Math.min(minimumThickness,thickness*point.factor);
    minimumOffset=Math.min(minimumOffset,point.baseOffset*point.factor);
    maxOffset=Math.max(maxOffset,point.baseOffset*point.factor);
  }
  for(const face of topology.faces) writer.add(face.vertices,face.material);
  for(const face of topology.faces) writer.add([inside(face.vertices[2],face.ids[2]),inside(face.vertices[1],face.ids[1]),inside(face.vertices[0],face.ids[0])],face.material);
  let rimTriangles=0;
  for(const edge of topology.boundaries) {
    const a=cloneVertex(edge.a),b=cloneVertex(edge.b),ai=inside(edge.a,edge.from),bi=inside(edge.b,edge.to);
    // Each reveal has its own 0..1 UV rectangle; exterior and inner UVs remain exact.
    if(a.uv) {a.uv=[0,0];b.uv=[1,0];ai.uv=[0,1];bi.uv=[1,1];}
    for(const vertices of [[b,a,ai],[b,ai,bi]]) {
      const normal=normalise(cross(sub(vertices[1].position,vertices[0].position),sub(vertices[2].position,vertices[0].position)));
      const copies=vertices.map(v=>{const c=cloneVertex(v);if(c.normal) c.normal=normal.slice();if(c.tangent) c.tangent=[...normalise(sub(b.position,a.position)),1];return c;});
      if(writer.add(copies,edge.material)) rimTriangles++;
    }
  }
  const result=writer.finish('inward wall shell');
  const warnings=['Normal-offset walls can intersect across nearby or concave surfaces. Inspect the interior; this is not an automatic watertight-solid repair.'];
  if(reducedVertices || sharpVertices) warnings.push(`Adaptive walls: ${reducedVertices} vertices were thinned to avoid local foldovers; ${sharpVertices} sharp vertices use a capped offset. Minimum local offset ${Number(minimumOffset.toPrecision(4))} model units (requested thickness ${thickness}).`);
  if(topology.degenerateTriangles) warnings.push(`${topology.degenerateTriangles} zero-area source triangles were omitted.`);
  return {...result,originalTriangles:input.triangles.length,thickness,minimumThickness,minimumOffset,maxOffset,reducedVertices,sharpVertices,adaptive,boundaryEdges:topology.boundaries.length,rimTriangles,warnings};
}
