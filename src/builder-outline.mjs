import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from '../vendor/three-0.160.1/build/three.module.js';

// A surface-preserving polygon/prism split. This is deliberately a bounded
// modelling operation, not a general CAD Boolean or a mesh repair operation.
// Source triangles are clipped (never selected by centroid). Closed inputs
// receive complementary caps from planar cross-sections of the source solid.
const MAX_TRIANGLES=350000, MAX_OUTPUT=1000000;
const insist=(condition,message)=>{if(!condition) throw new Error(message);};
const sub=(a,b)=>a.map((n,k)=>n-b[k]);
const add=(a,b)=>a.map((n,k)=>n+b[k]);
const mul=(a,s)=>a.map(n=>n*s);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a);
const unit=a=>mul(a,1/length(a));
const near=(a,b,e)=>Math.abs(a[0]-b[0])<=e&&Math.abs(a[1]-b[1])<=e&&Math.abs(a[2]-b[2])<=e;
const area2=v=>length(cross(sub(v[1].position,v[0].position),sub(v[2].position,v[0].position)));
const stableArea=(v,epsilon)=>area2(v)>epsilon*.25*Math.max(length(sub(v[1].position,v[0].position)),length(sub(v[2].position,v[1].position)),length(sub(v[0].position,v[2].position)));
const copy=v=>Object.fromEntries(Object.entries(v).map(([k,a])=>[k,a.slice()]));
const signedArea=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const inLoop=(p,loop)=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++) {const a=loop[i],b=loop[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) yes=!yes;}return yes;};

function spatialIds(epsilon) {
  const buckets=new Map(),points=[];
  return {points,id(p) {
    const c=p.map(n=>Math.floor(n/epsilon));
    for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++) {
      for(const id of buckets.get(`${c[0]+x},${c[1]+y},${c[2]+z}`)||[]) if(near(points[id],p,epsilon)) return id;
    }
    const id=points.length;points.push(p);const key=c.join(',');if(!buckets.has(key)) buckets.set(key,[]);buckets.get(key).push(id);return id;
  }};
}
function topology(triangles,epsilon) {
  const ids=spatialIds(epsilon),edges=new Map();let degenerate=0,volume=0;
  for(const tri of triangles) {
    const v=tri.vertices.map(x=>x.position),ind=v.map(p=>ids.id(p));
    if(new Set(ind).size<3||area2(tri.vertices)<=epsilon*epsilon*.01) {degenerate++;continue;}
    volume+=dot(v[0],cross(v[1],v[2]))/6;
    for(let i=0;i<3;i++) {const a=ind[i],b=ind[(i+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`;if(!edges.has(key)) edges.set(key,[]);edges.get(key).push(a<b?1:-1);}
  }
  let boundary=0,nonManifold=0,inconsistent=0;
  for(const directions of edges.values()) {if(directions.length===1) boundary++;else if(directions.length!==2) nonManifold++;else if(directions[0]===directions[1]) inconsistent++;}
  return {boundary,nonManifold,inconsistent,degenerate,volume};
}
function readGeometry(geometry) {
  insist(geometry?.isBufferGeometry,'Select a mesh before drawing a cut outline.');
  insist(!Object.values(geometry.morphAttributes||{}).some(a=>a.length)&&!geometry.getAttribute('skinIndex')&&!geometry.getAttribute('skinWeight'),'Apply skinning and morph targets before separating an outline.');
  const p=geometry.getAttribute('position'),index=geometry.index,count=index?.count??p?.count;
  insist(p&&p.itemSize===3&&count>=3&&count%3===0,'The selected object needs valid triangles.');
  insist(count/3<=MAX_TRIANGLES,`Outline cuts support ${MAX_TRIANGLES.toLocaleString()} source triangles per part. Reduce this part first.`);
  insist(geometry.drawRange.start===0&&(!Number.isFinite(geometry.drawRange.count)||geometry.drawRange.count>=count),'Apply the selected mesh draw range before cutting.');
  const attributes=Object.entries(geometry.attributes).map(([name,a])=>{insist(a.count===p.count&&a.itemSize>=1&&a.itemSize<=4,`Unsupported ${name} attribute layout.`);return {name,a,size:a.itemSize};});
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],vertices=[];
  for(let i=0;i<p.count;i++) {
    const vertex={};for(const {name,a,size} of attributes) {vertex[name]=Array.from({length:size},(_,k)=>a[['getX','getY','getZ','getW'][k]](i));insist(vertex[name].every(Number.isFinite),'The mesh contains a non-finite attribute.');}
    vertices.push(vertex);for(let k=0;k<3;k++) {min[k]=Math.min(min[k],vertex.position[k]);max[k]=Math.max(max[k],vertex.position[k]);}
  }
  const diagonal=length(sub(max,min));insist(diagonal>1e-12&&diagonal<1e10,'The selected mesh has invalid dimensions.');
  const epsilon=Math.max(diagonal*1e-7,1e-10),materials=new Int32Array(count/3),assigned=new Uint8Array(count/3);
  for(const g of geometry.groups) {
    insist(Number.isInteger(g.start)&&Number.isInteger(g.count)&&g.start>=0&&g.count>=0&&g.start%3===0&&g.count%3===0&&g.start+g.count<=count&&Number.isInteger(g.materialIndex)&&g.materialIndex>=0,'The selected mesh has unsupported material groups.');
    for(let i=g.start/3;i<(g.start+g.count)/3;i++) {insist(!assigned[i],'Separate overlapping material groups before cutting.');assigned[i]=1;materials[i]=g.materialIndex;}
  }
  const triangles=[];
  for(let i=0;i<count;i+=3) {const inds=[0,1,2].map(k=>index?index.getX(i+k):i+k);insist(inds.every(n=>Number.isInteger(n)&&n>=0&&n<vertices.length),'The mesh has an invalid triangle index.');triangles.push({vertices:inds.map(n=>vertices[n]),material:materials[i/3]});}
  return {geometry,attributes,triangles,epsilon,diagonal,min,max};
}
function blend(a,b,t,input) {
  const result={};for(const {name,size} of input.attributes) result[name]=Array.from({length:size},(_,i)=>a[name][i]+(b[name][i]-a[name][i])*t);
  if(result.normal&&length(result.normal)>1e-14) result.normal=unit(result.normal);
  if(result.tangent) {const xyz=result.tangent.slice(0,3);if(length(xyz)>1e-14) result.tangent=[...unit(xyz),result.tangent[3]<0?-1:1];}
  return result;
}
function centroid(vertices,input) {const v={};for(const {name,size} of input.attributes) v[name]=Array.from({length:size},(_,i)=>vertices.reduce((sum,x)=>sum+x[name][i],0)/vertices.length);if(v.normal&&length(v.normal)>1e-14) v.normal=unit(v.normal);return v;}
function plane(n,offset) {return {n,offset};}
function distance(p,pl) {return dot(p,pl.n)-pl.offset;}
function splitPolygon(vertices,pl,input) {
  const inside=[],outside=[],epsilon=input.epsilon*.01;
  const put=(list,v)=>{if(!list.length||!near(list[list.length-1].position,v.position,epsilon)) list.push(v);};
  for(let i=0;i<vertices.length;i++) {
    const a=vertices[i],b=vertices[(i+1)%vertices.length],da=distance(a.position,pl),db=distance(b.position,pl),ia=da>=-epsilon,ib=db>=-epsilon;
    put(ia?inside:outside,a);
    if(ia!==ib) {const t=Math.max(0,Math.min(1,da/(da-db))),v=blend(a,b,t,input);v.position=sub(v.position,mul(pl.n,distance(v.position,pl)));put(inside,v);put(outside,v);}
  }
  const tidy=list=>{if(list.length>1&&near(list[0].position,list.at(-1).position,epsilon)) list.pop();return list.length>=3?list:[];};
  return {inside:tidy(inside),outside:tidy(outside)};
}
function clip(vertices,planes,input) {for(const pl of planes) {vertices=splitPolygon(vertices,pl,input).inside;if(!vertices.length) break;}return vertices;}
function triangulate(vertices,material,output,input) {
  if(vertices.length<3) return;
  const emit=v=>{if(stableArea(v,input.epsilon)) {insist(output.length<MAX_OUTPUT,'The cut would exceed the one-million-triangle editing limit. Reduce the mesh or simplify the outline.');output.push({vertices:v,material});}};
  if(vertices.length===3) emit(vertices);else {const c=centroid(vertices,input);for(let i=0;i<vertices.length;i++) emit([c,vertices[i],vertices[(i+1)%vertices.length]]);}
}
function segmentsIntersect(a,b,c,d,epsilon) {
  const t=[turn(a,b,c),turn(a,b,d),turn(c,d,a),turn(c,d,b)];
  if(t[0]*t[1]<0&&t[2]*t[3]<0) return true;
  const on=(p,q,r)=>Math.abs(turn(p,q,r))<=epsilon&&r[0]>=Math.min(p[0],q[0])-epsilon&&r[0]<=Math.max(p[0],q[0])+epsilon&&r[1]>=Math.min(p[1],q[1])-epsilon&&r[1]<=Math.max(p[1],q[1])+epsilon;
  return on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function prepareOutline(options,input) {
  let {points,origin=[0,0,0],u=[1,0,0],v=[0,1,0],normal=[0,0,1],minDepth=-Infinity,maxDepth=Infinity}=options;
  const vector=x=>Array.isArray(x)&&x.length===3&&x.every(Number.isFinite);
  insist([origin,u,v,normal].every(vector),'The outline needs a finite view plane.');
  insist(length(u)>.9&&length(v)>.9&&length(normal)>.9,'The outline view direction is invalid.');
  u=unit(u);v=unit(v);normal=unit(normal);
  insist(Math.abs(dot(u,v))<1e-5&&Math.abs(dot(u,normal))<1e-5&&Math.abs(dot(v,normal))<1e-5&&dot(cross(u,v),normal)>.9999,'The outline view axes must form an orthogonal right-handed frame.');
  insist((Number.isFinite(minDepth)||minDepth===-Infinity)&&(Number.isFinite(maxDepth)||maxDepth===Infinity)&&maxDepth-minDepth>input.epsilon*10,'The cut needs a positive depth range.');
  insist(Array.isArray(points)&&points.length>=3&&points.length<=65&&points.every(vector),'Draw between 3 and 64 surface points for an outline.');
  let p=points.map(x=>[dot(sub(x,origin),u),dot(sub(x,origin),v)]);
  if(Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1])<=input.epsilon) p.pop();
  insist(p.length>=3&&p.length<=64,'Draw between 3 and 64 distinct surface points.');
  for(let i=0;i<p.length;i++) insist(Math.hypot(p[i][0]-p[(i+1)%p.length][0],p[i][1]-p[(i+1)%p.length][1])>input.epsilon*10,'Two outline points are too close. Remove the duplicate point.');
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++) {
    if(j===i+1||(i===0&&j===p.length-1)) continue;
    insist(!segmentsIntersect(p[i],p[(i+1)%p.length],p[j],p[(j+1)%p.length],input.epsilon**2),'The outline crosses or touches itself. Move or undo the crossing points.');
  }
  insist(Math.abs(signedArea(p))>input.epsilon**2*100,'The outline has no usable area. Draw points around a window or panel.');
  if(signedArea(p)<0) p.reverse();
  const triangles=ShapeUtils.triangulateShape(p.map(x=>new Vector2(...x)),[]);
  insist(triangles.length===p.length-2,'This outline cannot be triangulated. Remove collinear or overlapping points.');
  const world=xy=>add(origin,add(mul(u,xy[0]),mul(v,xy[1])));
  const edgePlane=(a,b)=>{const direction=unit(add(mul(u,-(b[1]-a[1])),mul(v,b[0]-a[0])));return plane(direction,dot(direction,world(a)));};
  const depthPlanes=[];if(Number.isFinite(minDepth)) depthPlanes.push(plane(normal,dot(normal,origin)+minDepth));if(Number.isFinite(maxDepth)) depthPlanes.push(plane(mul(normal,-1),-dot(normal,origin)-maxDepth));
  const wedges=triangles.map(indices=>{let q=indices.map(i=>p[i]);if(signedArea(q)<0) q=q.reverse();return q.map((a,i)=>edgePlane(a,q[(i+1)%3]));});
  const sides=p.map((a,i)=>{const b=p[(i+1)%p.length],pl=edgePlane(a,b),along=unit(sub(world(b),world(a)));return {plane:pl,normal:mul(pl.n,-1),u:along,v:normal,limits:[plane(along,dot(along,world(a))),plane(mul(along,-1),-dot(along,world(b))),...depthPlanes]};});
  const caps=[...sides];
  if(Number.isFinite(minDepth)) caps.push({plane:depthPlanes[0],normal:mul(normal,-1),u,v,wedges});
  if(Number.isFinite(maxDepth)) caps.push({plane:depthPlanes.at(-1),normal,u,v,wedges});
  const allPlanes=[];
  for(const pl of [...depthPlanes,...wedges.flat()]) if(!allPlanes.some(q=>Math.abs(Math.abs(dot(pl.n,q.n))-1)<1e-8&&Math.abs(pl.offset-(dot(pl.n,q.n)>0?q.offset:-q.offset))<input.epsilon)) allPlanes.push(pl);
  const bounds=[Math.min(...p.map(x=>x[0])),Math.max(...p.map(x=>x[0])),Math.min(...p.map(x=>x[1])),Math.max(...p.map(x=>x[1]))];
  return {p,origin,u,v,normal,minDepth,maxDepth,depthPlanes,wedges,caps,allPlanes,bounds};
}

function splitSurface(input,outline) {
  const outside=[],inside=[];
  for(const tri of input.triangles) {
    const coords=tri.vertices.map(x=>{const d=sub(x.position,outline.origin);return [dot(d,outline.u),dot(d,outline.v),dot(d,outline.normal)];});
    const b=outline.bounds;
    if(coords.every(p=>p[0]<b[0])||coords.every(p=>p[0]>b[1])||coords.every(p=>p[1]<b[2])||coords.every(p=>p[1]>b[3])||coords.every(p=>p[2]<outline.minDepth)||coords.every(p=>p[2]>outline.maxDepth)) {outside.push(tri);continue;}
    let remain=tri.vertices;
    for(const pl of outline.depthPlanes) {const s=splitPolygon(remain,pl,input);triangulate(s.outside,tri.material,outside,input);remain=s.inside;if(!remain.length) break;}
    let candidates=remain.length?[remain]:[];
    for(const wedge of outline.wedges) {
      const next=[];
      for(const candidate of candidates) {
        let rest=candidate;
        for(const pl of wedge) {const s=splitPolygon(rest,pl,input);if(s.outside.length) next.push(s.outside);rest=s.inside;if(!rest.length) break;}
        triangulate(rest,tri.material,inside,input);
      }
      candidates=next;if(!candidates.length) break;
    }
    for(const poly of candidates) triangulate(poly,tri.material,outside,input);
  }
  return {outside,inside};
}

// Intersect the original watertight solid with one cutter plane. Nested loops
// become holes, which is essential for cut reveals through an inward wall skin.
function sectionTriangles(input,cap) {
  const ids=spatialIds(input.epsilon*.5),vertices=[],edges=new Map();
  for(const tri of input.triangles) {
    const d=tri.vertices.map(v=>distance(v.position,cap.plane)),e=input.epsilon*.02;
    const positive=d.some(x=>x>e),negative=d.some(x=>x<-e),zero=d.filter(x=>Math.abs(x)<=e).length;
    // A snapped outline can run exactly through an existing mesh edge. Keep
    // that edge only when its incident faces lie on opposite sides; same-side
    // incidence is a tangent contact, not a cross-section of solid material.
    if(!(positive&&negative)&&zero!==2) continue;
    const cuts=[];
    for(let k=0;k<3;k++) {
      const a=tri.vertices[k],b=tri.vertices[(k+1)%3],da=d[k],db=d[(k+1)%3];
      if(Math.abs(da)<=e) cuts.push(a);
      else if(da*db<0) {const x=blend(a,b,da/(da-db),input);x.position=sub(x.position,mul(cap.plane.n,distance(x.position,cap.plane)));cuts.push(x);}
    }
    const unique=[];for(const v of cuts) if(!unique.some(x=>near(x.position,v.position,input.epsilon*.1))) unique.push(v);
    if(unique.length!==2) continue;
    const pair=unique.map(v=>{const id=ids.id(v.position);if(!vertices[id]) vertices[id]=v;return id;});if(pair[0]===pair[1]) continue;
    const key=pair[0]<pair[1]?pair.join('/'):pair.slice().reverse().join('/');
    if(!edges.has(key)) edges.set(key,{a:pair[0],b:pair[1],material:tri.material,strict:0,positive:0,negative:0});
    const edge=edges.get(key);if(positive&&negative) edge.strict++;else if(positive) edge.positive++;else if(negative) edge.negative++;
  }
  for(const [key,edge] of edges) if(!edge.strict&&!(edge.positive&&edge.negative)) edges.delete(key);
  if(!edges.size) return [];
  const adjacency=new Map();for(const [key,edge] of edges) for(const id of [edge.a,edge.b]) {if(!adjacency.has(id)) adjacency.set(id,[]);adjacency.get(id).push({key,edge});}
  insist([...adjacency.values()].every(a=>a.length===2),'A cut plane touches a mesh corner, degenerate fold or ambiguous junction. Move the outline slightly, or clean the selected part, then try again.');
  const used=new Set(),loops=[];
  for(const [firstKey,first] of edges) {
    if(used.has(firstKey)) continue;
    const loop=[],start=first.a;let current=start,previousKey=null,guard=0;
    do {loop.push(current);const next=adjacency.get(current).find(x=>x.key!==previousKey);insist(next&&!used.has(next.key),'The cut cross-section is not a simple closed loop. Move the outline or clean the mesh.');used.add(next.key);previousKey=next.key;current=next.edge.a===current?next.edge.b:next.edge.a;insist(++guard<=edges.size+1,'The cut cross-section could not be traced.');} while(current!==start);
    const xy=loop.map(id=>[dot(vertices[id].position,cap.u),dot(vertices[id].position,cap.v)]);
    if(Math.abs(signedArea(xy))>input.epsilon**2) loops.push({loop,xy,area:Math.abs(signedArea(xy)),material:first.material});
  }
  loops.sort((a,b)=>b.area-a.area);
  for(let i=0;i<loops.length;i++) {const l=loops[i];l.parent=-1;for(let j=i-1;j>=0;j--) if(inLoop(l.xy[0],loops[j].xy)) {l.parent=j;break;}l.depth=l.parent<0?0:loops[l.parent].depth+1;}
  const result=[];
  for(let i=0;i<loops.length;i++) {
    const outer=loops[i];if(outer.depth%2) continue;
    const holes=loops.filter(l=>l.parent===i&&l.depth===outer.depth+1),flat=[outer,...holes].flatMap(l=>l.loop.map(id=>vertices[id]));
    const faces=ShapeUtils.triangulateShape(outer.xy.map(p=>new Vector2(...p)),holes.map(l=>l.xy.map(p=>new Vector2(...p))));
    insist(faces.length,'The cut cross-section could not be filled. Try a simpler outline.');
    for(const face of faces) result.push({vertices:face.map(id=>flat[id]),material:outer.material});
  }
  return result;
}
function appendCaps(input,outline,result) {
  let count=0;
  for(const cap of outline.caps) {
    const sections=sectionTriangles(input,cap);
    for(const tri of sections) {
      const fragments=cap.limits?[clip(tri.vertices,cap.limits,input)]:cap.wedges.map(w=>clip(tri.vertices,w,input));
      for(const polygon of fragments) {
        if(polygon.length<3) continue;
        const patch=[];triangulate(polygon,tri.material,patch,input);
        for(const piece of patch) {
          let vs=piece.vertices.map(x=>{const a=copy(x);if(a.normal) a.normal=cap.normal.slice();if(a.tangent) a.tangent=[...cap.u,1];if(a.uv) a.uv=[dot(a.position,cap.u),dot(a.position,cap.v)];return a;});
          if(dot(cross(sub(vs[1].position,vs[0].position),sub(vs[2].position,vs[0].position)),cap.normal)<0) vs=vs.slice().reverse();
          result.inside.push({vertices:vs,material:piece.material});
          result.outside.push({vertices:vs.slice().reverse().map(x=>{const a=copy(x);if(a.normal) a.normal=a.normal.map(n=>-n);if(a.tangent) a.tangent[3]*=-1;return a;}),material:piece.material});count++;
        }
      }
    }
  }
  return count;
}

// Independent clipping partitions can introduce a vertex on their neighbour's
// edge. Share those vertices before triangulation, including seams between a
// cap and the original surface. The plane grid bounds the candidate search.
function conform(input,outline,result) {
  const all=[...result.outside,...result.inside],epsilon=input.epsilon,planes=[];
  for(const pl of outline.allPlanes) {
    const axis=Math.abs(pl.n[0])<.8?[1,0,0]:[0,1,0],u=unit(cross(pl.n,axis)),v=cross(pl.n,u),ids=spatialIds(epsilon*.2),points=[];
    for(const tri of all) for(const x of tri.vertices) if(Math.abs(distance(x.position,pl))<=epsilon*.5) {const id=ids.id(x.position);if(!points[id]) points[id]={p:x.position,x:dot(x.position,u),y:dot(x.position,v)};}
    if(!points.length) continue;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of points) {minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const cell=Math.max(Math.sqrt(Math.max((maxX-minX)*(maxY-minY),epsilon**2)/points.length)*2,input.diagonal/1000,epsilon*10),grid=new Map();
    for(const p of points) {const key=`${Math.floor((p.x-minX)/cell)},${Math.floor((p.y-minY)/cell)}`;if(!grid.has(key)) grid.set(key,[]);grid.get(key).push(p);}
    planes.push({...pl,u,v,minX,minY,cell,grid});
  }
  function candidatesOnEdge(a,b) {
    const edge=sub(b.position,a.position),len2=dot(edge,edge),found=[];
    if(len2<=epsilon**2) return found;
    const accept=p=>{const t=dot(sub(p,a.position),edge)/len2;if(t<=1e-7||t>=1-1e-7) return;const q=add(a.position,mul(edge,t));if(near(q,p,epsilon*.6)&&!found.some(x=>Math.abs(x.t-t)*Math.sqrt(len2)<epsilon*.4)) found.push({t,p});};
    for(const pl of planes) {
      const da=distance(a.position,pl),db=distance(b.position,pl);
      if(Math.abs(da)<=epsilon*.6&&Math.abs(db)<=epsilon*.6) {
        const ax=(dot(a.position,pl.u)-pl.minX)/pl.cell,ay=(dot(a.position,pl.v)-pl.minY)/pl.cell,bx=(dot(b.position,pl.u)-pl.minX)/pl.cell,by=(dot(b.position,pl.v)-pl.minY)/pl.cell;
        const steps=Math.max(1,Math.ceil(Math.max(Math.abs(bx-ax),Math.abs(by-ay))*1.5)),visited=new Set();
        for(let s=0;s<=steps;s++) {const x=Math.floor(ax+(bx-ax)*s/steps),y=Math.floor(ay+(by-ay)*s/steps);for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {const key=`${x+dx},${y+dy}`;if(visited.has(key)) continue;visited.add(key);for(const p of pl.grid.get(key)||[]) accept(p.p);}}
      } else if(da*db<0) {
        const q=add(a.position,mul(edge,da/(da-db))),x=Math.floor((dot(q,pl.u)-pl.minX)/pl.cell),y=Math.floor((dot(q,pl.v)-pl.minY)/pl.cell);
        for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(const p of pl.grid.get(`${x+dx},${y+dy}`)||[]) if(near(p.p,q,epsilon*.6)) accept(p.p);
      }
    }
    return found.sort((a,b)=>a.t-b.t);
  }
  for(const name of ['outside','inside']) {
    const output=[];
    for(const tri of result[name]) {
      const poly=[];for(let k=0;k<3;k++) {const a=tri.vertices[k],b=tri.vertices[(k+1)%3];poly.push(a);for(const c of candidatesOnEdge(a,b)) {const x=blend(a,b,c.t,input);x.position=c.p.slice();poly.push(x);}}
      triangulate(poly,tri.material,output,input);
    }
    result[name]=output;
  }
}
function makeGeometry(triangles,input,label) {
  const geometry=new BufferGeometry(),arrays=Object.fromEntries(input.attributes.map(a=>[a.name,[]]));let count=0,last;
  for(const tri of triangles) {
    if(!stableArea(tri.vertices,input.epsilon)) continue;
    if(last?.materialIndex===tri.material) last.count+=3;else {last={start:count,count:3,materialIndex:tri.material};geometry.groups.push(last);}
    for(const v of tri.vertices) for(const {name,size} of input.attributes) for(let k=0;k<size;k++) arrays[name].push(v[name][k]);count+=3;
  }
  insist(count>=3,'The outline must leave both a selected panel and a remaining object. Move or shrink the outline.');
  for(const {name,size} of input.attributes) geometry.setAttribute(name,new Float32BufferAttribute(arrays[name],size));
  if(!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData={...input.geometry.userData,builderSurfaceOperation:label};return geometry;
}
function canonicalisePositions(result,input) {
  // Use one exact Float32 position for coincident cut vertices on every surface
  // and cap. Otherwise tiny interpolation differences can become cracks after
  // export, especially when the separated panel is much smaller than its hull.
  const ids=spatialIds(input.epsilon*.6);
  for(const name of ['outside','inside']) {
    result[name]=result[name].map(tri=>({...tri,vertices:tri.vertices.map(vertex=>{
      const id=ids.id(vertex.position),p=ids.points[id];
      return {...vertex,position:p.map(Math.fround)};
    })})).filter(tri=>stableArea(tri.vertices,input.epsilon));
  }
}

/**
 * Separate a simple planar outline extruded through a depth slab. All positions
 * and depths are in the selected geometry's local coordinates. min/maxDepth
 * measure along `normal` from `origin`; +/-Infinity means through the object.
 * The returned geometries are owned by the caller. The original is untouched.
 * Closed, consistently wound sources are capped; open sources retain open cut
 * boundaries so either result can subsequently be shelled. Invalid topology or
 * an ambiguous cap fails before the caller replaces any object.
 */
export function splitOutlineGeometry(geometry,options={}) {
  const input=readGeometry(geometry),outline=prepareOutline(options,input),sourceTopology=topology(input.triangles,input.epsilon),warnings=[];
  insist(!sourceTopology.nonManifold&&!sourceTopology.inconsistent,'This part has non-manifold edges or inconsistent face orientation. Clean or repair it before separating an outline.');
  const closed=!sourceTopology.boundary;
  insist(!closed||sourceTopology.volume>input.epsilon**3,'The selected closed mesh faces inward. Flip its face orientation before cutting.');
  const result=splitSurface(input,outline);
  insist(result.inside.length&&result.outside.length,'The outline must intersect the surface and leave some of the selected part outside it. Move the outline or adjust its depth.');
  const cap=options.cap!==false&&closed;
  const capTriangles=cap?appendCaps(input,outline,result):0;
  if(!closed) warnings.push('The source has open boundaries. Both pieces retain open cut edges; create inner walls on either piece to add thickness and reveals.');
  else if(!cap) warnings.push('Capping is disabled. Both pieces have open cut boundaries.');
  if(sourceTopology.degenerate) warnings.push(`${sourceTopology.degenerate} zero-area source triangles were omitted.`);
  conform(input,outline,result);
  canonicalisePositions(result,input);
  const outsideTopology=topology(result.outside,input.epsilon),insideTopology=topology(result.inside,input.epsilon);
  insist(!outsideTopology.nonManifold&&!insideTopology.nonManifold&&!outsideTopology.inconsistent&&!insideTopology.inconsistent,`The cut produced an ambiguous junction (${outsideTopology.nonManifold}/${insideTopology.nonManifold} non-manifold, ${outsideTopology.inconsistent}/${insideTopology.inconsistent} inconsistent). Move the outline away from an existing mesh edge or clean the selected part.`);
  insist(!cap||(!outsideTopology.boundary&&!insideTopology.boundary),'The cut could not close every wall edge. Move the outline slightly or clean the mesh; the original object has not been changed.');
  const outside=makeGeometry(result.outside,input,'outline remainder'),inside=makeGeometry(result.inside,input,'separated outline panel');
  return {outside,inside,warnings,metrics:{sourceTriangles:input.triangles.length,outsideTriangles:outside.getAttribute('position').count/3,insideTriangles:inside.getAttribute('position').count/3,capTriangles,capped:cap,sourceBoundaryEdges:sourceTopology.boundary,outsideBoundaryEdges:outsideTopology.boundary,insideBoundaryEdges:insideTopology.boundary,sourceVolume:sourceTopology.volume,outsideVolume:outsideTopology.volume,insideVolume:insideTopology.volume,outlinePoints:outline.p.length}};
}
