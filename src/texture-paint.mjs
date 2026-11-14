import * as THREE from 'three';
import {check} from './core.mjs';
import {textureContainer,textureLayer,saveTextureLayers} from './texture-layers.mjs';
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const png=c=>new Promise((resolve,reject)=>c.toBlob(b=>b?b.arrayBuffer().then(v=>resolve(new Uint8Array(v))):reject(Error('Could not encode the texture.')),'image/png'));
const pause=()=>new Promise(r=>setTimeout(r,0));
const TILE=128;

/** A colour-only editor: unique UVs + world-space brush footprints across seams.
 * All mesh/skin/animation bytes remain in the original GLB container. */
export class TexturePaint {
  constructor(bytes,gltf){this.bytes=bytes;this.container=textureContainer(bytes);this.gltf=gltf;this.states=new Map();this.history=[];this.future=[];this.grid=new Map();this.large=[];this.parts=[];this.dirty=false;}
  async prepare(progress=()=>{}){
    const object=this.gltf.scene;object.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(object);this.cell=bounds.getSize(new THREE.Vector3()).length()/64;check(this.cell>0,'The model is empty.');
    const meshes=[];object.traverseVisible(m=>{if(m.isMesh)meshes.push(m);});let offset=0;
    for(const mesh of meshes){
      const g=mesh.geometry,p=g.attributes.position,positions=new Float32Array(p.count*3),v=new THREE.Vector3();
      for(let i=0;i<p.count;i++){mesh.getVertexPosition(i,v).applyMatrix4(mesh.matrixWorld);positions.set(v.toArray(),i*3);}
      const mats=[mesh.material].flat(),materials=mats.map(m=>{const id=this.gltf.parser.associations.get(m)?.materials,j=this.container.json.materials?.[id],t=j?.pbrMetallicRoughness?.baseColorTexture;return m.map&&t?{image:this.container.json.textures[t.index].source,map:m.map,material:m}:null;});
      const count=(g.index?.count??p.count)/3,materialAt=new Uint16Array(count);for(const group of g.groups)for(let f=group.start/3;f<(group.start+group.count)/3;f++)materialAt[f]=group.materialIndex;
      const part={mesh,g,positions,materials,materialAt,offset,count,orientation:Math.sign(mesh.matrixWorld.determinant())};this.parts.push(part);
      for(let f=0;f<count;f++){
        const xyz=[0,1,2].map(k=>{const id=g.index?g.index.getX(f*3+k):f*3+k;return [positions[id*3],positions[id*3+1],positions[id*3+2]];});
        const lo=[0,1,2].map(k=>Math.floor(Math.min(...xyz.map(p=>p[k]))/this.cell)),hi=[0,1,2].map(k=>Math.floor(Math.max(...xyz.map(p=>p[k]))/this.cell));
        if((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1)>128)this.large.push(offset+f);
        else for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){const key=x+','+y+','+z;let list=this.grid.get(key);if(!list)this.grid.set(key,list=[]);list.push(offset+f);}
        if(f%32768===32767){progress('Preparing texture brush…');await pause();}
      }offset+=count;
    }
    this.meshForFace=new Uint16Array(offset);this.parts.forEach((p,i)=>this.meshForFace.fill(i,p.offset,p.offset+p.count));
    check(this.parts.some(p=>p.materials.some(Boolean)),'This model has no embedded base-colour texture. Bake or apply a texture first.');
  }
  target(hit){const part=this.parts.find(p=>p.mesh===hit.object);return part?.materials[hit.face.materialIndex||0];}
  async state(image){
    if(this.states.has(image))return this.states.get(image);
    const saved=textureLayer(this.container,image),base=canvas(saved.width,saved.height),paint=canvas(saved.width,saved.height),composite=canvas(saved.width,saved.height);
    const draw=async(c,bytes,type)=>{const bitmap=await createImageBitmap(new Blob([bytes],{type}));c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();};
    await draw(base,saved.base,saved.baseMime);if(saved.paint)await draw(paint,saved.paint,'image/png');
    const s={...saved,base,paint,composite,data:paint.getContext('2d').getImageData(0,0,saved.width,saved.height).data,textures:[],changed:false};
    for(const p of this.parts)for(const m of p.materials)if(m?.image===image){const map=m.map.clone();map.source=new THREE.Source(composite);map.needsUpdate=true;m.material.map=map;s.textures.push(map);}
    this.states.set(image,s);this.update(s);return s;
  }
  update(s,visible=true){const ctx=s.composite.getContext('2d');ctx.clearRect(0,0,s.width,s.height);ctx.drawImage(s.base,0,0);ctx.globalAlpha=visible?s.opacity:0;ctx.drawImage(s.paint,0,0);ctx.globalAlpha=1;for(const t of s.textures)t.needsUpdate=true;}
  uv(target,hit){const attribute=hit.object.geometry.getAttribute(target.map.channel?'uv'+target.map.channel:'uv');check(attribute,'The colour texture has no UV coordinates.');const tri=hit.face,g=hit.object.geometry;const p=hit.point.clone();hit.object.worldToLocal(p);const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();hit.object.getVertexPosition(tri.a,a);hit.object.getVertexPosition(tri.b,b);hit.object.getVertexPosition(tri.c,c);const bary=THREE.Triangle.getBarycoord(p,a,b,c,new THREE.Vector3());const uv=new THREE.Vector2(attribute.getX(tri.a)*bary.x+attribute.getX(tri.b)*bary.y+attribute.getX(tri.c)*bary.z,attribute.getY(tri.a)*bary.x+attribute.getY(tri.b)*bary.y+attribute.getY(tri.c)*bary.z);target.map.updateMatrix();return uv.applyMatrix3(target.map.matrix);}
  sample(s,uv){const d=s.composite.getContext('2d').getImageData(Math.min(s.width-1,Math.max(0,Math.floor(uv.x*s.width))),Math.min(s.height-1,Math.max(0,Math.floor(uv.y*s.height))),1,1).data;return '#'+[...d.slice(0,3)].map(n=>n.toString(16).padStart(2,'0')).join('');}
  tile(s,key,write){const columns=Math.ceil(s.width/TILE),x=(key%columns)*TILE,y=Math.floor(key/columns)*TILE,w=Math.min(TILE,s.width-x),h=Math.min(TILE,s.height-y),data=write||new Uint8ClampedArray(w*h*4);for(let row=0;row<h;row++){const at=((y+row)*s.width+x)*4;if(write)s.data.set(data.subarray(row*w*4,(row+1)*w*4),at);else data.set(s.data.subarray(at,at+w*4),row*w*4);}if(write)s.paint.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),w,h),x,y);return data;}
  begin(s){check(!this.stroke,'Finish the current stroke.');this.stroke={image:s.image,before:new Map(),opacity:s.opacity,wasChanged:s.changed,wasDirty:this.dirty};}
  paintAt(s,point,radius,{colour,flow=.6,softness=.5,erase=false,visible=()=>true,cameraDirection}){
    check(this.stroke?.image===s.image,'Choose one colour texture for this stroke.');
    const candidates=new Set(this.large),c=point.toArray(),lo=c.map(v=>Math.floor((v-radius)/this.cell)),hi=c.map(v=>Math.floor((v+radius)/this.cell));
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++)for(const f of this.grid.get(x+','+y+','+z)||[])candidates.add(f);
    const dirty=new Set(),written=new Set(),a=new THREE.Vector3(),b=new THREE.Vector3(),n=new THREE.Vector3();
    for(const global of candidates){
      const part=this.parts[this.meshForFace[global]],f=global-part.offset,target=part.materials[part.materialAt[f]];if(!target||target.image!==s.image)continue;
      const g=part.g,index=g.index,ids=[0,1,2].map(k=>index?index.getX(f*3+k):f*3+k),p=ids.map(id=>Array.from(part.positions.subarray(id*3,id*3+3))),attr=g.getAttribute(target.map.channel?'uv'+target.map.channel:'uv');if(!attr)continue;
      n.fromArray(p[1]).sub(a.fromArray(p[0])).cross(b.fromArray(p[2]).sub(a)).normalize().multiplyScalar(part.orientation);if(cameraDirection&&n.dot(cameraDirection)<.01)continue;
      target.map.updateMatrix();const uv=ids.map(id=>new THREE.Vector2(attr.getX(id),attr.getY(id)).applyMatrix3(target.map.matrix));
      // Painting repeats/mirrors would also change all other copies of that UV.
      if(uv.some(t=>t.x<-.00001||t.y<-.00001||t.x>1.00001||t.y>1.00001))continue;
      const q=uv.map(v=>[v.x*s.width,v.y*s.height]),ax=q[1][0]-q[0][0],ay=q[1][1]-q[0][1],bx=q[2][0]-q[0][0],by=q[2][1]-q[0][1],area=ax*by-ay*bx;if(Math.abs(area)<1e-8)continue;
      const minX=Math.max(0,Math.floor(Math.min(...q.map(v=>v[0])))),maxX=Math.min(s.width-1,Math.ceil(Math.max(...q.map(v=>v[0])))),minY=Math.max(0,Math.floor(Math.min(...q.map(v=>v[1])))),maxY=Math.min(s.height-1,Math.ceil(Math.max(...q.map(v=>v[1]))));
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const u=((x+.5-q[0][0])*by-(y+.5-q[0][1])*bx)/area,v=(ax*(y+.5-q[0][1])-ay*(x+.5-q[0][0]))/area;if(u<-.0001||v<-.0001||u+v>1.0001)continue;
        const xyz=[0,1,2].map(k=>p[0][k]+u*(p[1][k]-p[0][k])+v*(p[2][k]-p[0][k])),distance=Math.hypot(...xyz.map((v,k)=>v-c[k]))/radius;if(distance>1||!visible(xyz))continue;
        const pixel=y*s.width+x;if(written.has(pixel))continue;written.add(pixel);const key=Math.floor(y/TILE)*Math.ceil(s.width/TILE)+Math.floor(x/TILE);if(!this.stroke.before.has(key))this.stroke.before.set(key,this.tile(s,key));dirty.add(key);
        const t=Math.max(0,Math.min(1,(1-distance)/Math.max(.001,softness))),alpha=flow*t*t*(3-2*t),at=pixel*4,old=s.data[at+3]/255,next=erase?old*(1-alpha):alpha+old*(1-alpha);
        if(!erase&&next>0)for(let k=0;k<3;k++)s.data[at+k]=Math.round((colour[k]*alpha+s.data[at+k]*old*(1-alpha))/next);
        s.data[at+3]=Math.round(next*255);if(!s.data[at+3])s.data.fill(0,at,at+4);
      }
    }
    for(const key of dirty)this.tile(s,key,this.tile(s,key));if(dirty.size){s.changed=this.dirty=true;this.update(s);}return dirty.size;
  }
  end(cancel=false){const stroke=this.stroke;if(!stroke)return;this.stroke=null;const s=this.states.get(stroke.image);if(cancel){for(const [key,data]of stroke.before)this.tile(s,key,data);s.changed=stroke.wasChanged;this.dirty=stroke.wasDirty;this.update(s);return;}if(!stroke.before.size)return;stroke.after=new Map([...stroke.before].map(([key])=>[key,this.tile(s,key)]));this.history.push(stroke);this.future=[];let memory=this.history.reduce((n,h)=>n+[...h.before.values()].reduce((v,a)=>v+a.length*2,0),0);while(this.history.length>12||(memory>32*1024**2&&this.history.length>1)){const h=this.history.shift();memory-=[...h.before.values()].reduce((v,a)=>v+a.length*2,0);}}
  undo(redo=false){check(!this.stroke,'Finish the stroke first.');const from=redo?this.future:this.history,to=redo?this.history:this.future,h=from.pop();if(!h)return;const s=this.states.get(h.image);for(const [k,v]of redo?h.after:h.before)this.tile(s,k,v);s.changed=this.dirty=true;this.update(s);to.push(h);}
  async save(){const changes=[];for(const s of this.states.values())if(s.changed){this.update(s);changes.push({image:s.image,opacity:s.opacity,paint:await png(s.paint),composite:await png(s.composite)});}return changes.length?saveTextureLayers(this.bytes,changes):this.bytes;}
  dispose(){for(const s of this.states.values()){for(const t of s.textures)t.dispose();s.base.width=s.paint.width=s.composite.width=1;}this.states.clear();this.grid.clear();this.history=[];this.future=[];this.parts=[];this.meshForFace=null;}
}
