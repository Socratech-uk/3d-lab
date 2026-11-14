import {projectionFrame,sourceUv,alignment} from './texture-alignment.mjs';
/** Orthographic, visibility-tested source-image baking. Ordinary indexed UVs
 * and an embedded atlas; no shader patches, extra surface meshes or inference. */
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check} from './core.mjs';
import {PROJECTION_AXES,textureImage,canvasOf,chartGeometry,staticGeometry,pause} from './builder-materials.mjs';

function stopped(signal){check(!signal?.aborted,'Texture baking cancelled.');}
function materialIndices(g, materialCount) {
  const count=(g.index?.count??g.attributes.position.count)/3,indices=new Int32Array(count);
  if(materialCount===1)return indices;
  for(const group of g.groups)for(let i=group.start/3;i<Math.min(count,(group.start+group.count)/3);i++)indices[i]=group.materialIndex;
  return indices;
}
function positionsFor(mesh) {
  const g=staticGeometry(mesh),p=g.attributes.position,out=new Float32Array(p.count*3),v=new THREE.Vector3();
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);check([v.x,v.y,v.z].every(Number.isFinite),'The model contains an invalid vertex.');out.set([v.x,v.y,v.z],i*3);}
  return {mesh,g,positions:out,index:g.index,faces:(g.index?.count??p.count)/3};
}
function coordinates(data,face,view,out) {
  const a=view.axes,p=data.positions,index=data.index;
  for(let k=0;k<3;k++){const id=(index?index.getX(face*3+k):face*3+k)*3,j=k*3;out[j]=p[id+a[0]]*a[1];out[j+1]=p[id+a[2]]*a[3];out[j+2]=p[id+a[4]]*a[5];}
}
function raster(view,q,size) {
  const x0=(q[0]-view.minX)/view.width*(size-1),y0=(q[1]-view.minY)/view.height*(size-1),x1=(q[3]-view.minX)/view.width*(size-1),y1=(q[4]-view.minY)/view.height*(size-1),x2=(q[6]-view.minX)/view.width*(size-1),y2=(q[7]-view.minY)/view.height*(size-1);
  const area=(x1-x0)*(y2-y0)-(y1-y0)*(x2-x0);
  if(Math.abs(area)<1e-14)return;
  const loX=Math.max(0,Math.ceil(Math.min(x0,x1,x2))),hiX=Math.min(size-1,Math.floor(Math.max(x0,x1,x2))),loY=Math.max(0,Math.ceil(Math.min(y0,y1,y2))),hiY=Math.min(size-1,Math.floor(Math.max(y0,y1,y2)));
  view.samples+=(hiX-loX+1)*(hiY-loY+1);
  check(view.samples<160_000_000,'Too many overlapping surfaces for this bake. Isolate the target parts and retry.');
  for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
    const b=((x-x0)*(y2-y0)-(y-y0)*(x2-x0))/area,c=((x1-x0)*(y-y0)-(y1-y0)*(x-x0))/area;
    if(b<-.000001||c<-.000001||b+c>1.000001)continue;
    const z=q[2]+b*(q[5]-q[2])+c*(q[8]-q[2]),at=y*size+x;if(z>view.depth[at])view.depth[at]=z;
  }
  // Sub-pixel triangles must still occlude a face behind them.
  const at=Math.round((y0+y1+y2)/3)*size+Math.round((x0+x1+x2)/3),z=(q[2]+q[5]+q[8])/3;
  if(at>=0&&at<view.depth.length&&z>view.depth[at])view.depth[at]=z;
}

function regroup(geometry,keys,materials) {
  const counts=new Map();for(const k of keys)counts.set(k,(counts.get(k)||0)+3);
  const groups=[],starts=new Map();let offset=0;
  for(const [key,count] of counts){starts.set(key,offset);groups.push({start:offset,count,materialIndex:groups.length,key});offset+=count;}
  const cursors=new Map(starts),old=geometry.index.array,out=new Uint32Array(old.length);
  for(let f=0;f<keys.length;f++){const k=keys[f],at=cursors.get(k);out.set(old.subarray(f*3,f*3+3),at);cursors.set(k,at+3);}
  geometry.setIndex(new THREE.BufferAttribute(out,1));geometry.clearGroups();
  for(const g of groups)geometry.addGroup(g.start,g.count,g.materialIndex);
  return groups.map(g=>materials(g.key));
}

export async function bakeSourceTextures(object, parts, references, options={}) {
  const {atlasSize=2048,crop=true,scale=1,offsetX=0,offsetY=0,flipX=false,widthScale=1,heightScale=1,viewSettings={},minFacing=.25,signal,onProgress=()=>{}}=options;
  stopped(signal);
  check([1024,2048,4096].includes(atlasSize),'Choose a 1024, 2048 or 4096 texture atlas.');
  check(Number.isFinite(scale)&&scale>=.01&&scale<=100&&[offsetX,offsetY].every(n=>Number.isFinite(n)&&Math.abs(n)<=10),'Choose a valid projection scale and offsets.');
  check(Number.isFinite(minFacing)&&minFacing>=.05&&minFacing<=.95,'Use a facing threshold from .05 to .95.');
  const entries=Object.entries(references);check(entries.length>0&&entries.length<=6&&entries.every(([v,r])=>PROJECTION_AXES[v]&&r?.blob instanceof Blob),'Choose at least one valid source view.');
  check(parts.length>0&&parts.every(m=>m.visible&&!m.userData.builderLocked&&!m.userData.cappReferenceProjection),'Choose visible, unlocked mesh parts without projection overlays.');
  object.updateMatrixWorld(true);const all=[];object.traverseVisible(m=>{if(m.isMesh&&!m.userData.cappReferenceProjection)all.push(positionsFor(m));});
  const targets=new Set(parts),targetData=all.filter(d=>targets.has(d.mesh));check(targetData.length===parts.length,'The selected parts must be visible in the scene.');
  // Use complete object framing, even when only one component receives texture.
  const bounds=new THREE.Box3();for(const d of all)for(let i=0;i<d.positions.length;i+=3)bounds.expandByPoint(new THREE.Vector3(d.positions[i],d.positions[i+1],d.positions[i+2]));
  const minimum=bounds.min.toArray(),maximum=bounds.max.toArray(),diagonal=bounds.getSize(new THREE.Vector3()).length();check(diagonal>0,'The model has empty bounds.');
  const side=Math.ceil(Math.sqrt(entries.length)),cell=Math.floor(atlasSize/side),gutter=4,atlas=canvasOf(atlasSize,atlasSize),ctx=atlas.getContext('2d');check(ctx,'A canvas is required to bake textures.');
  const base=[parts[0].material].flat()[0]?.color||new THREE.Color('#aab7c8');ctx.fillStyle='#'+base.getHexString();ctx.fillRect(0,0,atlasSize,atlasSize);
  const views=[];const depthSize=512;
  for(let i=0;i<entries.length;i++) {
    stopped(signal);const [name,ref]=entries[i],image=await textureImage(ref.blob,{size:2048}),axes=PROJECTION_AXES[name],cropBox=crop?image.crop:[0,0,image.canvas.width,image.canvas.height];
    const cfg=alignment({scale,widthScale,heightScale,offsetX,offsetY,flipX,...viewSettings[name]}),frame=projectionFrame(minimum,maximum,name,cropBox[2],cropBox[3],cfg);
    const {minX,minY,width,height,imageWidth,imageHeight}=frame,x=(i%side)*cell+gutter,y=Math.floor(i/side)*cell+gutter,tile=cell-gutter*2;
    ctx.drawImage(image.canvas,...cropBox,x,y,tile,tile);
    // Extend border texels into gutters to avoid filtering across chart tiles.
    ctx.drawImage(atlas,x,y,tile,1,x,y-gutter,tile,gutter);ctx.drawImage(atlas,x,y+tile-1,tile,1,x,y+tile,tile,gutter);
    ctx.drawImage(atlas,x,y,1,tile,x-gutter,y,gutter,tile);ctx.drawImage(atlas,x+tile-1,y,1,tile,x+tile,y,gutter,tile);
    const depth=new Float32Array(depthSize*depthSize);depth.fill(-Infinity);
    const pixels=image.canvas.getContext('2d').getImageData(0,0,image.canvas.width,image.canvas.height).data;
    views.push({...frame,name,x,y,tile,depth,samples:0,pixels,sourceWidth:image.canvas.width,sourceHeight:image.canvas.height,cropBox});
  }
  const q=new Float64Array(9),total=all.reduce((n,d)=>n+d.faces,0);let done=0;
  for(const view of views) {
    onProgress('Checking visible surfaces · '+view.name);
    for(const data of all)for(let f=0;f<data.faces;f++) {
      coordinates(data,f,view,q);raster(view,q,depthSize);
      if(++done%32768===0){stopped(signal);onProgress('Checking visible surfaces · '+Math.round(done/(total*views.length)*100)+'%');await pause();}
    }
  }
  let painted=0,unchanged=0,seamVertices=0;const perView=Object.fromEntries(views.map(v=>[v.name,0]));
  const texture=new THREE.CanvasTexture(atlas);texture.colorSpace=THREE.SRGBColorSpace;texture.name='Source image atlas';texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  const uv=sourceUv;
  let usedTexture=false;
  try {for(const data of targetData) {
    const {mesh,g,positions,index}=data,charts=new Int8Array(data.faces).fill(-1),oldMaterialIndex=materialIndices(g,[mesh.material].flat().length),keys=new Int32Array(data.faces),orientation=Math.sign(mesh.matrixWorld.determinant());
    const previousChannel=mesh.userData.builderSourceTexture?.uvChannel;
    const reusable=Number.isInteger(previousChannel)&&previousChannel>=0&&previousChannel<4&&[mesh.material].flat().every(m=>Object.entries(m).every(([key,v])=>!v?.isTexture||v.channel!==previousChannel||(key==='map'&&v.name==='Source image atlas')));
    const channel=reusable?previousChannel:[0,1,2,3].find(n=>!g.getAttribute(n?'uv'+n:'uv'));
    check(channel!==undefined,'All four UV channels are in use. Bake a mesh copy with a free UV channel.');
    const uvName=channel?'uv'+channel:'uv',existingUV=g.getAttribute(uvName);
    for(let f=0;f<data.faces;f++) {
      let best=-1,score=minFacing;
      for(let i=0;i<views.length;i++) {
        const view=views[i];coordinates(data,f,view,q);
        const ax=q[3]-q[0],ay=q[4]-q[1],az=q[5]-q[2],bx=q[6]-q[0],by=q[7]-q[1],bz=q[8]-q[2];
        const nz=ax*by-ay*bx,length=Math.hypot(ay*bz-az*by,az*bx-ax*bz,nz),facing=nz/length*orientation;
        if(!(facing>minFacing))continue;
        const cx=(q[0]+q[3]+q[6])/3,cy=(q[1]+q[4]+q[7])/3,z=(q[2]+q[5]+q[8])/3;
        const px=Math.round((cx-view.minX)/view.width*(depthSize-1)),py=Math.round((cy-view.minY)/view.height*(depthSize-1));
        if(px<0||px>=depthSize||py<0||py>=depthSize)continue;
        const tolerance=diagonal*1e-5+(Math.abs(ay*bz-az*by)*view.width+Math.abs(az*bx-ax*bz)*view.height)/(Math.max(Math.abs(nz),1e-20)*(depthSize-1));
        if(view.depth[py*depthSize+px]>z+tolerance)continue;
        let inside=true;for(let k=0;k<3;k++){const t=uv(view,q[k*3],q[k*3+1]);if(t.some(v=>v<0||v>1)){inside=false;break;}}
        if(inside){
          // Transparent source regions are missing evidence, not base-colour paint.
          // Test the centre and inset corners so one isolated opaque pixel does not
          // claim an otherwise empty face. Score confidence before choosing a view.
          let confidence=1;
          for(const weights of [[1/3,1/3,1/3],[.8,.1,.1],[.1,.8,.1],[.1,.1,.8]]){
            const sx=weights.reduce((n,w,k)=>n+w*q[k*3],0),sy=weights.reduce((n,w,k)=>n+w*q[k*3+1],0),[u,v]=uv(view,sx,sy);
            const ix=Math.max(0,Math.min(view.sourceWidth-1,Math.floor(view.cropBox[0]+u*(view.cropBox[2]-1)))),iy=Math.max(0,Math.min(view.sourceHeight-1,Math.floor(view.cropBox[1]+(1-v)*(view.cropBox[3]-1))));
            confidence=Math.min(confidence,view.pixels[(iy*view.sourceWidth+ix)*4+3]/255);
          }
          const candidate=facing*confidence;if(confidence>=.8&&candidate>score){score=candidate;best=i;}
        }
      }
      charts[f]=best;keys[f]=oldMaterialIndex[f]*2+(best>=0?1:0);
      if(best>=0){painted++;perView[views[best].name]++;}else unchanged++;
      if(f%16384===16383){stopped(signal);onProgress('Baking source colours · '+(painted+unchanged).toLocaleString()+' faces');await pause();}
    }
    if(!charts.some(c=>c>=0))continue;
    const geometry=await chartGeometry(g,charts,(id,chart)=>{
      if(chart<0)return existingUV?[existingUV.getX(id),existingUV.getY(id)]:[0,0];
      const view=views[chart],axis=view.axes,p=id*3,[u,v]=uv(view,positions[p+axis[0]]*axis[1],positions[p+axis[2]]*axis[3]);
      return [(view.x+.5+u*(view.tile-1))/atlasSize,1-(view.y+.5+(1-v)*(view.tile-1))/atlasSize];
    },uvName);
    stopped(signal);const old=[mesh.material].flat(),atlasTexture=texture.clone();atlasTexture.channel=channel;atlasTexture.needsUpdate=true;
    const materials=regroup(geometry,keys,key=>{const source=old[Math.floor(key/2)]||old[0];check(source,'The mesh has an invalid material group.');const m=source.clone();if(key%2){m.map=atlasTexture;m.color?.set(0xffffff);m.vertexColors=false;m.name=(source.name||mesh.name||'Surface')+' · source texture';}m.needsUpdate=true;return m;});
    seamVertices+=geometry.attributes.position.count-g.attributes.position.count;mesh.geometry=geometry;g.dispose();mesh.material=materials;
    const retained=new Set(materials.flatMap(m=>Object.values(m).filter(v=>v?.isTexture)));
    for(const m of old){for(const v of Object.values(m))if(v?.isTexture&&!retained.has(v))v.dispose();m.dispose();}
    mesh.userData.builderSourceTexture={version:1,views:views.map(v=>v.name),atlasSize,uvChannel:channel,crop,scale,offsetX,offsetY,flipX,viewSettings:Object.fromEntries(views.map(v=>[v.name,alignment(v)])),method:'orthographic-visible-surface',sourceConfidence:'alpha-centre-and-corners',depthResolution:depthSize};usedTexture=true;
  }
  check(painted>0,'No faces received a texture. Check the view direction, selection and alignment.');
  onProgress('Baked '+painted.toLocaleString()+' faces. '+unchanged.toLocaleString()+' faces kept their materials.');
  return {painted,unchanged,seamVertices,perView,warnings:['Source colours are baked into the GLB. Unseen faces keep their materials; image lighting and view seams may remain.']};
  } finally {texture.dispose();if(!usedTexture)atlas.width=atlas.height=1;}
}
