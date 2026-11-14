import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import { check } from './core.mjs';
import { createActionDocument,createJoint,createClip,normalizeActionDocument,uid,setPoseKey } from './action-document.mjs';

export const identityPose=()=>({position:[0,0,0],rotation:[0,0,0,1]});
export function meshes(root){const result=[];root.traverse(n=>{if(n.isMesh)result.push(n);});return result;}
export function cloneMaterial(material){const copy=m=>{const c=m.clone();for(const [key,v]of Object.entries(m))if(v?.isTexture)c[key]=v.clone();return c;};return Array.isArray(material)?material.map(copy):copy(material);}
export function cloneBase(root){const result=new THREE.Group();for(const m of meshes(root)){const copy=new THREE.Mesh(m.geometry.clone(),cloneMaterial(m.material));copy.name=m.name;copy.userData=structuredClone(m.userData);copy.visible=m.visible;result.add(copy);}return result;}
function reverseWinding(g){if(!g.index)g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i));for(let i=0;i<g.index.count;i+=3){const a=g.index.getX(i);g.index.setX(i,g.index.getX(i+2));g.index.setX(i+2,a);}if(g.attributes.tangent)for(let i=0;i<g.attributes.tangent.count;i++)g.attributes.tangent.setW(i,-g.attributes.tangent.getW(i));}
function checkSkinBindPose(source){
  const deformation=new THREE.Matrix4(),identity=new THREE.Matrix4().elements;
  source.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    for(let i=0;i<mesh.skeleton.bones.length;i++){
      const bone=mesh.skeleton.bones[i],inverse=mesh.skeleton.boneInverses[i];
      // Extraction retains unposed vertices and rebuilds the inverse bind matrices
      // from the current joints. Accept that conversion only when the imported
      // skin currently leaves its local vertices in the same rest pose.
      check(bone&&inverse,'This GLB has an incomplete bind pose. Export the GLB in its bind/rest pose before opening it in Action Lab.');
      deformation.copy(mesh.bindMatrixInverse).multiply(bone.matrixWorld).multiply(inverse).multiply(mesh.bindMatrix);
      check(deformation.elements.every((value,index)=>Number.isFinite(value)&&Math.abs(value-identity[index])<=1e-4),'This GLB’s skeleton does not match its inverse bind matrices. Export the GLB in its bind/rest pose before opening it in Action Lab; its current pose cannot be imported safely.');
    }
  });
}
/** Convert the complete imported scene into model-space mesh data. No viewer normalization. */
export function extractActionScene(source,saved=null,title='Action scene'){
  source.updateMatrixWorld(true);checkSkinBindPose(source);let doc=saved?normalizeActionDocument(saved):createActionDocument(title);const base=new THREE.Group(),boneIds=new Map(),boneOrder=[];
  if(!saved){source.traverse(n=>{if(n.isBone){check(boneOrder.length<128,'Use a rig with at most 128 joints.');boneIds.set(n,uid('joint'));boneOrder.push(n);}});doc.joints=boneOrder.map(b=>{let p=b.parent;while(p&&!p.isBone)p=p.parent;const j=createJoint(b.getWorldPosition(new THREE.Vector3()).toArray(),p?boneIds.get(p):null,b.name||'Joint');j.id=boneIds.get(b);j.rotation=b.getWorldQuaternion(new THREE.Quaternion()).toArray();return j;});}
  else source.traverse(n=>{if(n.isBone){const match=doc.joints.find(j=>j.id===n.userData.actionJointId||n.name==='joint_'+j.id);if(match)boneIds.set(n,match.id);}});
  if(!saved&&source.animations?.length){check(boneOrder.length,'This GLB has object animation without a skeleton. Open a static copy and create hinge or slider joints before animating it in Action Lab.');for(const clip of source.animations)for(const track of clip.tracks){const target=THREE.PropertyBinding.findNode(source,THREE.PropertyBinding.parseTrackName(track.name).nodeName);let affectsBone=false,affectsUnskinnedMesh=false;target?.traverse(n=>{if(n.isBone)affectsBone=true;if(n.isMesh&&!n.isSkinnedMesh)affectsUnskinnedMesh=true;});check(affectsBone&&!affectsUnskinnedMesh,'This animation includes object tracks outside its skeleton. Bake moving mesh parts into joints and skin them before importing into Action Lab.');}}
  const jointIndex=new Map(doc.joints.map((j,i)=>[j.id,i]));
  let serial=0;
  for(const m of meshes(source)){
    check(!Object.values(m.geometry.morphAttributes||{}).some(a=>a.length),'Apply morph targets before editing this model in Action Lab.');
    const geometry=m.geometry.clone();geometry.applyMatrix4(m.matrixWorld);if(m.matrixWorld.determinant()<0)reverseWinding(geometry);
    const id=m.userData.actionMeshId||'mesh-'+(++serial),copy=new THREE.Mesh(geometry,cloneMaterial(m.material));copy.name=m.name||'Part '+serial;copy.userData={...structuredClone(m.userData),actionMeshId:id};copy.visible=m.visible;
    if(m.isSkinnedMesh){const old=geometry.attributes.skinIndex;check(old&&geometry.attributes.skinWeight,'Incomplete imported skin.');const mapped=new Uint16Array(old.count*4);for(let i=0;i<old.count;i++)for(let k=0;k<4;k++){const b=m.skeleton.bones[old.array[i*4+k]],index=jointIndex.get(boneIds.get(b));check(index!==undefined,'Imported skeleton has joints outside the saved rig.');mapped[i*4+k]=index;}geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(mapped,4));doc.bindings[id]||={mode:'skin'};}
    else doc.bindings[id]||={mode:'unbound'};
    base.add(copy);
  }
  check(base.children.length,'Choose a model with visible mesh geometry.');
  if(!saved&&source.animations?.length&&boneOrder.length){
    check(!source.animations.some(c=>c.tracks.some(t=>t.name.endsWith('.scale'))),'Bake animated scale before importing motion into Action Lab.');const canonical=createRig(doc);const rest=boneOrder.map(b=>({position:b.position.clone(),quaternion:b.quaternion.clone(),scale:b.scale.clone()})),mixer=new THREE.AnimationMixer(source);doc.clips=[];
    for(const clip of source.animations.slice(0,32)){check(clip.duration<=120,'Imported actions must be no longer than 120 seconds.');const c=createClip(clip.name||'Imported action',Math.max(.05,clip.duration)),count=Math.ceil(c.duration*30);check(count*boneOrder.length+doc.clips.reduce((n,v)=>n+Object.values(v.tracks).reduce((a,k)=>a+k.length,0),0)<=180000,'Imported animation exceeds the editable key budget.');const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
      for(let frame=0;frame<=count;frame++){const time=Math.min(c.duration,frame/30);mixer.setTime(time);source.updateMatrixWorld(true);for(let i=0;i<boneOrder.length;i++){const bone=boneOrder[i],id=boneIds.get(bone),joint=doc.joints.find(j=>j.id===id),parent=boneOrder.find(b=>boneIds.get(b)===joint.parent),parentQ=parent?parent.getWorldQuaternion(new THREE.Quaternion()):new THREE.Quaternion(),position=bone.getWorldPosition(new THREE.Vector3());if(parent)position.sub(parent.getWorldPosition(new THREE.Vector3()));position.applyQuaternion(parentQ.clone().invert());const localQ=parentQ.invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));setPoseKey(c,id,time,{position:position.sub(canonical.rest.get(id).position).toArray(),rotation:canonical.rest.get(id).rotation.clone().invert().multiply(localQ).toArray()});}}
      mixer.stopAllAction();doc.clips.push(c);
    }
    boneOrder.forEach((b,i)=>{b.position.copy(rest[i].position);b.quaternion.copy(rest[i].quaternion);b.scale.copy(rest[i].scale);});mixer.uncacheRoot(source);canonical.skeleton.dispose();
  }
  return {base,document:normalizeActionDocument(doc)};
}
export function createRig(doc){
  const root=new THREE.Group(),bones=new Map(),rest=new Map(),byId=new Map(doc.joints.map(j=>[j.id,j]));
  for(const j of doc.joints){const b=new THREE.Bone();b.name='joint_'+j.id;b.userData.actionJointId=j.id;bones.set(j.id,b);}
  for(const j of doc.joints){const b=bones.get(j.id),p=byId.get(j.parent),world=new THREE.Matrix4().compose(new THREE.Vector3(...j.position),new THREE.Quaternion(...j.rotation),new THREE.Vector3(1,1,1));if(p)world.premultiply(new THREE.Matrix4().compose(new THREE.Vector3(...p.position),new THREE.Quaternion(...p.rotation),new THREE.Vector3(1,1,1)).invert());world.decompose(b.position,b.quaternion,b.scale);(p?bones.get(p.id):root).add(b);rest.set(j.id,{position:b.position.clone(),rotation:b.quaternion.clone()});}
  root.updateMatrixWorld(true);const skeleton=new THREE.Skeleton(doc.joints.map(j=>bones.get(j.id)));skeleton.calculateInverses();return {root,bones,rest,skeleton};
}
export function constrainedPose(j,pose){
  if(j.type==='fixed')return identityPose();
  const q=new THREE.Quaternion(...pose.rotation).normalize(),p=new THREE.Vector3(...pose.position),axis=new THREE.Vector3(...j.axis);
  if(j.type==='slider')return {position:axis.multiplyScalar(THREE.MathUtils.clamp(p.dot(axis),j.min,j.max)).toArray(),rotation:[0,0,0,1]};
  if(j.type==='hinge'){const projection=q.x*axis.x+q.y*axis.y+q.z*axis.z;let angle=2*Math.atan2(projection,q.w);angle=THREE.MathUtils.euclideanModulo(angle+Math.PI,Math.PI*2)-Math.PI;const bounded=THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(angle),j.min,j.max);return {position:[0,0,0],rotation:new THREE.Quaternion().setFromAxisAngle(axis,THREE.MathUtils.degToRad(bounded)).toArray()};}
  return {position:p.toArray(),rotation:q.toArray()};
}
export function applyPose(rig,doc,poses={}){for(const j of doc.joints){const b=rig.bones.get(j.id),r=rig.rest.get(j.id),p=constrainedPose(j,poses[j.id]||identityPose());b.position.copy(r.position).add(new THREE.Vector3(...p.position));b.quaternion.copy(r.rotation).multiply(new THREE.Quaternion(...p.rotation));}rig.root.updateMatrixWorld(true);rig.skeleton.update();}
export function buildActionScene(base,doc,poses={}){
  const rig=createRig(doc),root=rig.root;
  for(const m of meshes(base)){const binding=doc.bindings[m.userData.actionMeshId]||{mode:'unbound'},g=m.geometry.clone();let output;
    if(binding.mode==='rigid'){const index=doc.joints.findIndex(j=>j.id===binding.joint),count=g.attributes.position.count,indices=new Uint16Array(count*4),weights=new Float32Array(count*4);check(index>=0,'Rigid joint is missing.');for(let i=0;i<count;i++){indices[i*4]=index;weights[i*4]=1;}g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));}
    if(binding.mode!=='unbound'){check(doc.joints.length&&g.attributes.skinIndex&&g.attributes.skinWeight,'Bind this mesh before posing it.');for(const index of g.attributes.skinIndex.array)check(index<doc.joints.length,'Skin weights need rebinding after joint removal.');output=new THREE.SkinnedMesh(g,cloneMaterial(m.material));output.bind(rig.skeleton,new THREE.Matrix4());output.frustumCulled=false;}
    else {g.deleteAttribute('skinIndex');g.deleteAttribute('skinWeight');output=new THREE.Mesh(g,cloneMaterial(m.material));}
    output.name=m.name;output.userData={...structuredClone(m.userData),actionMeshId:m.userData.actionMeshId};output.visible=m.visible;root.add(output);
  }
  applyPose(rig,doc,poses);root.userData.cappActionDocument=structuredClone(doc);return rig;
}
/** Segment proximity binding is deterministic and editable; never labelled neural. */
export function autoBind(base,doc,selectedIds=null){
  check(doc.joints.length,'Place joints or add a starting rig first.');const byId=new Map(doc.joints.map(j=>[j.id,j])),jointIndex=new Map(doc.joints.map((j,i)=>[j.id,i]));
  // A joint rotates the bone going OUT from its pivot. Assigning an incoming
  // segment to its child makes the forearm follow the wrist and the shin the ankle.
  const segments=doc.joints.map(j=>({owner:jointIndex.get(j.parent||j.id),line:new THREE.Line3(new THREE.Vector3(...(byId.get(j.parent)?.position||j.position)),new THREE.Vector3(...j.position))}));
  for(const j of doc.joints)if(!doc.joints.some(c=>c.parent===j.id))segments.push({owner:jointIndex.get(j.id),line:new THREE.Line3(new THREE.Vector3(...j.position),new THREE.Vector3(...j.position))});
  const v=new THREE.Vector3(),nearest=new THREE.Vector3(),bounds=new THREE.Box3().setFromObject(base),soft=Math.max(bounds.getSize(new THREE.Vector3()).length()*.012,1e-5);
  for(const m of meshes(base)){if(selectedIds&&!selectedIds.includes(m.userData.actionMeshId))continue;const positions=m.geometry.attributes.position;check(positions.count*doc.joints.length<=80_000_000,'Bind a smaller mesh or fewer joints for an interactive result.');const indices=new Uint16Array(positions.count*4),weights=new Float32Array(positions.count*4);
    for(let i=0;i<positions.count;i++){v.fromBufferAttribute(positions,i);const distances=new Map();for(const {owner,line} of segments){if(line.distanceSq()<1e-16)nearest.copy(line.start);else line.closestPointToPoint(v,true,nearest);const distance=v.distanceToSquared(nearest);distances.set(owner,Math.min(distances.get(owner)??Infinity,distance));}const best=[...distances].map(([index,distance])=>({index,distance})).sort((a,b)=>a.distance-b.distance).slice(0,4);const values=best.map(b=>1/(b.distance+soft*soft)**2),sum=values.reduce((a,b)=>a+b,0);for(let k=0;k<best.length;k++){indices[i*4+k]=best[k].index;weights[i*4+k]=values[k]/sum;}}
    m.geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));m.geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));doc.bindings[m.userData.actionMeshId]={mode:'skin'};
  }
}
export function paintWeights(mesh,joint,point,radius,strength,subtract=false,normal=null){
  const g=mesh.geometry,p=g.attributes.position,indices=g.attributes.skinIndex,weights=g.attributes.skinWeight;check(indices&&weights,'Bind the selected part before painting weights.');check(radius>0&&strength>0&&strength<=1,'Invalid weight brush.');const v=new THREE.Vector3(),n=new THREE.Vector3();let changed=0;
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);const distance=v.distanceTo(point);if(distance>radius)continue;if(normal&&g.attributes.normal&&n.fromBufferAttribute(g.attributes.normal,i).dot(normal)<0)continue;const values=new Map();for(let k=0;k<4;k++)values.set(indices.array[i*4+k],(values.get(indices.array[i*4+k])||0)+weights.array[i*4+k]);const old=values.get(joint)||0,next=THREE.MathUtils.clamp(old+(subtract?-1:1)*strength*(1-distance/radius)**2,0,1);values.set(joint,next);const others=[...values].filter(([id])=>id!==joint).sort((a,b)=>b[1]-a[1]).slice(0,3),sum=others.reduce((a,b)=>a+b[1],0);if(!sum&&next<1)continue;const entries=[[joint,next],...others.map(([id,w])=>[id,sum>0?w/sum*(1-next):0])];for(let k=0;k<4;k++){indices.array[i*4+k]=entries[k]?.[0]||0;weights.array[i*4+k]=entries[k]?.[1]||0;}changed++;}
  indices.needsUpdate=weights.needsUpdate=true;return changed;
}
export function sampleClip(clip,time){const result={};time=Math.max(0,Math.min(clip.duration,time));for(const [joint,keys]of Object.entries(clip.tracks)){if(!keys.length)continue;let i=0;while(i+1<keys.length&&keys[i+1].time<=time)i++;const a=keys[i],b=keys[i+1]||a,t=a===b||a.interpolation==='STEP'?0:THREE.MathUtils.clamp((time-a.time)/(b.time-a.time),0,1);result[joint]={position:new THREE.Vector3(...a.position).lerp(new THREE.Vector3(...b.position),t).toArray(),rotation:new THREE.Quaternion(...a.rotation).slerp(new THREE.Quaternion(...b.rotation),t).toArray()};}return result;}
export function animationClips(doc,rig){check(doc.clips.reduce((n,c)=>n+Object.values(c.tracks).filter(k=>k.length).length*(Math.ceil(c.duration*c.fps)+1)*2,0)<=540000,'Animation export exceeds the baked-key budget. Shorten clips or reduce their frame rate.');return doc.clips.filter(c=>Object.values(c.tracks).some(k=>k.length)).map(c=>{const tracks=[];for(const [id,keys]of Object.entries(c.tracks)){if(!keys.length)continue;const rest=rig.rest.get(id),times=[],positions=[],rotations=[];const steps=Math.ceil(c.duration*c.fps);for(let i=0;i<=steps;i++){const t=Math.min(c.duration,i/c.fps),pose=constrainedPose(doc.joints.find(j=>j.id===id),sampleClip({...c,tracks:{[id]:keys}},t)[id]);times.push(t);positions.push(...rest.position.clone().add(new THREE.Vector3(...pose.position)).toArray());rotations.push(...rest.rotation.clone().multiply(new THREE.Quaternion(...pose.rotation)).toArray());}tracks.push(new THREE.VectorKeyframeTrack('joint_'+id+'.position',times,positions),new THREE.QuaternionKeyframeTrack('joint_'+id+'.quaternion',times,rotations));}return new THREE.AnimationClip(c.name,c.duration,tracks);});}
export function addTemplate(doc,base,type='humanoid'){
  check(!doc.joints.length,'Clear the rig first, or add joints to the existing rig.');const bounds=new THREE.Box3().setFromObject(base),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const rows=type==='humanoid'?[
    ['Hips',null,0,.5,0],['Spine','Hips',0,.62,0],['Chest','Spine',0,.74,0],['Neck','Chest',0,.85,0],['Head','Neck',0,.93,0],
    ['LeftShoulder','Chest',.16,.77,0],['LeftArm','LeftShoulder',.24,.77,0],['LeftForeArm','LeftArm',.37,.76,0],['LeftHand','LeftForeArm',.49,.75,0],
    ['RightShoulder','Chest',-.16,.77,0],['RightArm','RightShoulder',-.24,.77,0],['RightForeArm','RightArm',-.37,.76,0],['RightHand','RightForeArm',-.49,.75,0],
    ['LeftUpLeg','Hips',.10,.45,0],['LeftLeg','LeftUpLeg',.10,.25,0],['LeftFoot','LeftLeg',.10,.05,.05],['LeftToeBase','LeftFoot',.10,.03,.20],
    ['RightUpLeg','Hips',-.10,.45,0],['RightLeg','RightUpLeg',-.10,.25,0],['RightFoot','RightLeg',-.10,.05,.05],['RightToeBase','RightFoot',-.10,.03,.20]
  ]:[['Hips',null,0,.60,-.28],['Spine','Hips',0,.65,-.04],['Chest','Spine',0,.66,.20],['Neck','Chest',0,.77,.32],['Head','Neck',0,.87,.41],['Tail','Hips',0,.66,-.42],['TailTip','Tail',0,.76,-.50],...[-1,1].flatMap(sign=>{const side=sign===1?'Left':'Right';return [[side+'FrontUpper','Chest',sign*.28,.55,.23],[side+'FrontLower',side+'FrontUpper',sign*.28,.28,.23],[side+'FrontFoot',side+'FrontLower',sign*.28,.05,.28],[side+'BackUpper','Hips',sign*.28,.52,-.28],[side+'BackLower',side+'BackUpper',sign*.28,.28,-.21],[side+'BackFoot',side+'BackLower',sign*.28,.05,-.28]];})];
  const names=new Map();for(const [name,parent,x,y,z]of rows){const j=createJoint([center.x+x*size.x,bounds.min.y+y*size.y,center.z+z*size.z],names.get(parent)||null,name);names.set(name,j.id);doc.joints.push(j);}return doc;
}
export function solveIK(rig,doc,poses,endId,target,chainLength=3){
  const byId=new Map(doc.joints.map(j=>[j.id,j]));check(byId.has(endId),'Select an endpoint joint.');applyPose(rig,doc,poses);const end=rig.bones.get(endId);let chain=[],id=byId.get(endId).parent;while(id&&chain.length<chainLength){chain.push(id);id=byId.get(id).parent;}
  for(let iteration=0;iteration<12;iteration++){for(const id of chain){const j=byId.get(id);if(j.locked||j.type==='fixed'||j.type==='slider')continue;const b=rig.bones.get(id),origin=b.getWorldPosition(new THREE.Vector3()),a=end.getWorldPosition(new THREE.Vector3()).sub(origin),desired=target.clone().sub(origin);if(a.lengthSq()<1e-10||desired.lengthSq()<1e-10)continue;const world=new THREE.Quaternion().setFromUnitVectors(a.normalize(),desired.normalize()).multiply(b.getWorldQuaternion(new THREE.Quaternion())),parent=b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();const delta=rig.rest.get(id).rotation.clone().invert().multiply(parent.multiply(world));poses[id]=constrainedPose(j,{position:poses[id]?.position||[0,0,0],rotation:delta.toArray()});applyPose(rig,doc,poses);}if(end.getWorldPosition(new THREE.Vector3()).distanceTo(target)<1e-4)break;}return poses;
}
