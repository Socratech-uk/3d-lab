import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import { check } from './core.mjs';
import { createClip } from './action-document.mjs';
import {motionTargetNames} from './action-anatomy.mjs';
import { createRig,identityPose } from './action-geometry.mjs';
import {jointNameKey as key,jointKey} from './action-joint-names.mjs';
export {jointKey} from './action-joint-names.mjs';
export function validateMotion(data){
  check(data?.format==='capp.motion.v1'&&Number.isFinite(data.fps)&&data.fps>=1&&data.fps<=120,'Unsupported motion data.');check(Array.isArray(data.joints)&&data.joints.length>0&&data.joints.length<=128&&Array.isArray(data.frames)&&data.frames.length>1&&data.frames.length<=7200&&data.frames.length/data.fps<=120.1&&data.frames.length*data.joints.length<=180000,'Motion exceeds the joint or duration budget.');
  const vec=v=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e6);
  const names=new Set();for(let i=0;i<data.joints.length;i++){const j=data.joints[i];check(typeof j.name==='string'&&j.name.length>0&&j.name.length<=120&&!names.has(j.name)&&Number.isInteger(j.parent)&&j.parent>=-1&&j.parent<i&&vec(j.position),'Invalid motion skeleton.');names.add(j.name);}
  check(data.rotationSpace===undefined||['world-rest-delta','world-delta','world'].includes(data.rotationSpace),'Unsupported motion rotation space.');
  if(data.rotationSpace==='world')check(data.joints.every(j=>Array.isArray(j.rotation)&&j.rotation.length===4&&j.rotation.every(Number.isFinite)&&Math.abs(Math.hypot(...j.rotation)-1)<.01),'Absolute world rotations require source rest orientations.');
  const timed=data.frames.some(f=>f?.time!==undefined),rotated=data.frames.some(f=>f?.rotations!==undefined);let previous=-1;
  for(const [i,f]of data.frames.entries()){
    check(f&&Array.isArray(f.positions)&&f.positions.length===data.joints.length&&f.positions.every(vec),'Invalid motion frame.');
    if(rotated)check(Array.isArray(f.rotations)&&f.rotations.length===data.joints.length&&f.rotations.every(q=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<.01),'Invalid motion rotation.');
    if(timed){check(Number.isFinite(f.time)&&f.time>=0&&f.time<=120&&(i===0?f.time===0:f.time>previous+1e-7),'Motion frame times must start at zero and increase.');previous=f.time;}
  }
  const end=timed?data.frames.at(-1).time:(data.frames.length-1)/data.fps;
  check(end>0&&end<=120,'Invalid motion duration.');
  if(data.durationSeconds!==undefined)check(Number.isFinite(data.durationSeconds)&&Math.abs(data.durationSeconds-end)<1e-6,'Motion duration does not match its final frame.');
  return data;
}
/** BVH is parsed as bounded data. No expression evaluation or external resources. */
export function parseBVH(text){
  check(typeof text==='string'&&text.length<=16*1024**2,'Choose a BVH motion smaller than 16 MiB.');const tokens=text.match(/[^\s{}]+|[{}]/g)||[];let cursor=0;const read=()=>tokens[cursor++],expect=s=>check(read()===s,'Invalid BVH: expected '+s),num=()=>{const n=Number(read());check(Number.isFinite(n)&&Math.abs(n)<=1e6,'Invalid BVH number.');return n;};const joints=[];
  function joint(parent,type){check(joints.length<128,'BVH exceeds 128 joints.');const name=read();expect('{');expect('OFFSET');const offset=[num(),num(),num()];expect('CHANNELS');const n=num();check(Number.isInteger(n)&&n>=0&&n<=6,'Invalid BVH channels.');const channels=Array.from({length:n},()=>read());check(new Set(channels).size===n&&channels.every(c=>/^[XYZ](position|rotation)$/.test(c)),'Unsupported BVH channels.');const index=joints.length;joints.push({name,parent,offset,channels});while(tokens[cursor]!=='}'){const type=read();if(type==='JOINT')joint(index,type);else{check(type==='End','Invalid BVH hierarchy.');expect('Site');expect('{');expect('OFFSET');num();num();num();expect('}');}}expect('}');}
  expect('HIERARCHY');expect('ROOT');joint(-1,'ROOT');expect('MOTION');expect('Frames:');const count=num();expect('Frame');expect('Time:');const dt=num();check(Number.isInteger(count)&&count>1&&count<=7200&&dt>0&&count*dt<=120.1&&count*joints.length<=180000,'BVH duration exceeds the action budget.');
  const frame=values=>{const matrices=[],positions=[];for(let i=0;i<joints.length;i++){const j=joints[i],p=new THREE.Vector3(...j.offset),q=new THREE.Quaternion();if(values)for(const channel of j.channels){const value=num(),axis=channel[0].toLowerCase();if(channel.endsWith('position'))p[axis]+=value;else q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0),THREE.MathUtils.degToRad(value)));}const matrix=new THREE.Matrix4().compose(p,q,new THREE.Vector3(1,1,1));if(j.parent>=0)matrix.premultiply(matrices[j.parent]);matrices.push(matrix);positions.push(new THREE.Vector3().setFromMatrixPosition(matrix).toArray());}return {positions};};
  const rest=frame(false).positions,frames=Array.from({length:count},()=>frame(true));check(cursor===tokens.length,'Unexpected trailing BVH content.');return validateMotion({format:'capp.motion.v1',fps:1/dt,joints:joints.map((j,i)=>({name:j.name,parent:j.parent,position:rest[i]})),frames});
}
/** Map semantic joints, solve orientations from animated bone directions and keep target lengths. */
export function retargetMotion(doc,motion,{name='Generated action',inPlace=false}={}){
  validateMotion(motion);check(doc.joints.length,'Add and bind a rig before generating motion.');const targetNames=motionTargetNames(doc),targetName=j=>targetNames[j.id]||j.name;const sourceByName=new Map(motion.joints.map((j,i)=>[key(j.name),i])),mapping=new Map(),used=new Set();
  // Exact anatomical names win before aliases. In HumanML3D both Spine and
  // Spine1 exist; collapsing them into one map silently stole Spine's motion.
  for(const joint of doc.joints){if(doc.bodyMap&&!targetNames[joint.id])continue;const index=sourceByName.get(key(targetName(joint)));if(index!==undefined){mapping.set(joint.id,index);used.add(index);}}
  for(const joint of doc.joints){if(mapping.has(joint.id)||doc.bodyMap&&!targetNames[joint.id])continue;const candidates=motion.joints.map((j,i)=>({j,i})).filter(({j,i})=>!used.has(i)&&jointKey(j.name)===jointKey(targetName(joint)));if(candidates.length===1){mapping.set(joint.id,candidates[0].i);used.add(candidates[0].i);}}check(mapping.size>=Math.min(5,doc.joints.length),'This motion does not match the rig’s joint names. Use a compatible humanoid/animal rig or rename its joints.');
  const rig=createRig(doc),byId=new Map(doc.joints.map(j=>[j.id,j])),children=new Map();for(const j of doc.joints)if(j.parent){if(!children.has(j.parent))children.set(j.parent,[]);children.get(j.parent).push(j);}
  const roots=doc.joints.filter(j=>!j.parent&&mapping.has(j.id)),root=roots[0]||doc.joints.find(j=>mapping.has(j.id)),travelRoot=doc.joints.find(j=>!j.parent),sourceRoot=mapping.get(root.id),restSource=new THREE.Vector3(...motion.frames[0].positions[sourceRoot]);restSource.y=motion.joints[sourceRoot].position[1];
  const lengths=[];for(const j of doc.joints)if(j.parent&&mapping.has(j.id)&&mapping.has(j.parent)){const a=new THREE.Vector3(...j.position).distanceTo(new THREE.Vector3(...byId.get(j.parent).position)),b=new THREE.Vector3(...motion.joints[mapping.get(j.id)].position).distanceTo(new THREE.Vector3(...motion.joints[mapping.get(j.parent)].position));if(a>1e-6&&b>1e-6)lengths.push(a/b);}lengths.sort((a,b)=>a-b);const scale=lengths.length?lengths[Math.floor(lengths.length/2)]:1;
  const duration=motion.frames.at(-1).time??(motion.frames.length-1)/motion.fps,clip=createClip(name,duration);clip.fps=Math.min(60,Math.round(motion.fps));const ordered=[...doc.joints].sort((a,b)=>{const depth=j=>j.parent?1+depth(byId.get(j.parent)):0;return depth(a)-depth(b);});
  check(motion.frames.length*doc.joints.filter(j=>mapping.has(j.id)&&j.type==='ball').length<=180000,'This motion exceeds the editable key budget.');
  // Accumulate ordered tracks once. Re-sorting an entire track for every new key
  // turns a long action import into quadratic work and stalls the editor.
  for(let frame=0;frame<motion.frames.length;frame++){const poses={},worldRotations=new Map(),positions=motion.frames[frame].positions;for(const j of ordered){const parentWorld=worldRotations.get(j.parent)||new THREE.Quaternion(),rest=rig.rest.get(j.id);if(!mapping.has(j.id)||j.type!=='ball'){if(j.id===travelRoot.id&&!inPlace){poses[j.id]=identityPose();poses[j.id].position=new THREE.Vector3(...positions[sourceRoot]).sub(restSource).multiplyScalar(scale).toArray();}worldRotations.set(j.id,parentWorld.clone().multiply(rest.rotation));continue;}const source=mapping.get(j.id);let pose=identityPose();if(j.id===travelRoot.id&&!inPlace)pose.position=new THREE.Vector3(...positions[source]).sub(restSource).multiplyScalar(scale).toArray();const queue=[...(children.get(j.id)||[])];let child;while(queue.length&&!child){const c=queue.shift();if(mapping.has(c.id))child=c;else queue.push(...(children.get(c.id)||[]));}
      if(motion.frames[frame].rotations){const deformation=new THREE.Quaternion(...motion.frames[frame].rotations[source]);if(motion.rotationSpace==='world')deformation.multiply(new THREE.Quaternion(...motion.joints[source].rotation).invert());const desiredWorld=deformation.multiply(new THREE.Quaternion(...j.rotation));pose.rotation=rest.rotation.clone().invert().multiply(parentWorld.clone().invert().multiply(desiredWorld)).normalize().toArray();}
      else if(child){const targetRest=new THREE.Vector3(...child.position).sub(new THREE.Vector3(...j.position)),sourceRest=new THREE.Vector3(...motion.joints[mapping.get(child.id)].position).sub(new THREE.Vector3(...motion.joints[source].position)),sourceNow=new THREE.Vector3(...positions[mapping.get(child.id)]).sub(new THREE.Vector3(...positions[source]));
        if(sourceRest.lengthSq()>1e-12&&sourceNow.lengthSq()>1e-12&&targetRest.lengthSq()>1e-12){const deltaWorld=new THREE.Quaternion().setFromUnitVectors(sourceRest.normalize(),sourceNow.normalize()),desired=targetRest.clone().normalize().applyQuaternion(deltaWorld);const restWorld=parentWorld.clone().multiply(rest.rotation),current=targetRest.clone().applyQuaternion(new THREE.Quaternion(...j.rotation).invert()).applyQuaternion(restWorld);const world=new THREE.Quaternion().setFromUnitVectors(current.normalize(),desired.normalize()).multiply(restWorld);pose.rotation=rest.rotation.clone().invert().multiply(parentWorld.clone().invert().multiply(world)).normalize().toArray();}
      }
      poses[j.id]=pose;worldRotations.set(j.id,parentWorld.clone().multiply(rest.rotation).multiply(new THREE.Quaternion(...pose.rotation)));
    }
    const time=motion.frames[frame].time??frame/motion.fps;for(const [id,pose]of Object.entries(poses))(clip.tracks[id]||=[]).push({time,position:pose.position,rotation:pose.rotation,interpolation:'LINEAR'});
  }
  rig.skeleton.dispose();return {clip,mapped:mapping.size,total:doc.joints.length};
}
