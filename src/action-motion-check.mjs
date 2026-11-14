import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {jointKey} from './action-joint-names.mjs';
import {motionTargetNames,motionRigStatus} from './action-anatomy.mjs';
import {createClip} from './action-document.mjs';
import {check} from './core.mjs';

/** Deterministic diagnostics, not a motion-quality score or a foot-contact solver. */
export function inspectActionMotion(doc,clip){
 const names=motionTargetNames(doc),roots=doc.joints.filter(j=>j.parent===null),q=new THREE.Quaternion(),qa=new THREE.Quaternion(),qb=new THREE.Quaternion();
 let travel=0,maxStep=0;const limbRanges=[];
 const positions=doc.joints.map(j=>j.position),height=Math.max(1e-6,...[0,1,2].map(k=>Math.max(...positions.map(p=>p[k]))-Math.min(...positions.map(p=>p[k]))));
 for(const j of doc.joints){const keys=clip.tracks[j.id]||[];if(keys.length<2)continue;let range=0;qa.fromArray(keys[0].rotation);for(let i=0;i<keys.length;i++){q.fromArray(keys[i].rotation);range=Math.max(range,qa.angleTo(q));if(i){qb.fromArray(keys[i-1].rotation);maxStep=Math.max(maxStep,qb.angleTo(q));}}
  if(/(?:upleg|leg|frontupper|frontlower|backupper|backlower)$/.test(jointKey(names[j.id]||j.name)))limbRanges.push({name:names[j.id]||j.name,degrees:range*180/Math.PI});
  if(roots.includes(j)){const p=keys[0].position;for(const k of keys)travel=Math.max(travel,Math.hypot(k.position[0]-p[0],k.position[2]-p[2])/height);}
 }
 const locomotion=/\b(?:walk(?:s|ing)?|run(?:s|ning)?|jog(?:s|ging)?|trot(?:s|ting)?|gallop(?:s|ing)?|sprint(?:s|ing)?|locomotion)\b/i.test((clip.provenance?.prompt||'')+' '+clip.name);
 const active=limbRanges.filter(r=>r.degrees>=8).length,messages=[];
 if(locomotion&&limbRanges.length&&active<2)messages.push(travel>.05?'Mostly root travel: the legs barely articulate. This clip is likely to slide or drag the character.':'Very little leg articulation for a walking/running prompt. Review the body map and try another variation.');
 if(maxStep>Math.PI*.5)messages.push('A joint turns more than 90° between adjacent keys. Scrub the action to check for a sudden flip.');
 if(locomotion&&!limbRanges.length)messages.push('No recognised leg tracks to check. Review the body map before using this as locomotion.');
 return {messages,rootTravelInBodyLengths:travel,activeLegJoints:active,legJoints:limbRanges.length,maximumStepDegrees:maxStep*180/Math.PI,locomotion};
}
/** Preview-only horizontal anchoring; keep vertical jumps and original keys. */
export function inPlacePreview(doc,clip,pose){
 const result=structuredClone(pose);for(const joint of doc.joints.filter(j=>j.parent===null)){const first=clip.tracks[joint.id]?.[0];if(result[joint.id]&&first){result[joint.id].position[0]=first.position[0];result[joint.id].position[2]=first.position[2];}}return result;
}

/** An explicitly local diagnostic action, so skinning can be checked without AI. */
export function createBodyBendTest(doc){
 const status=motionRigStatus(doc);check(!status.issues.length&&status.map,'Review a human or animal body map before testing bends.');
 check(Object.values(doc.bindings).some(b=>b.mode==='skin'||b.mode==='rigid'),'Bind the mesh before testing bends.');
 const clip=createClip('Rig bend check · local',3),map=status.map.roles;
 const roles=status.map.kind==='humanoid'?['LeftForeArm','LeftLeg','RightForeArm','RightLeg']:['LeftFrontLower','LeftBackLower','RightFrontLower','RightBackLower'];
 for(const role of roles){const id=map[role],joint=doc.joints.find(j=>j.id===id);if(!joint)continue;
  const axis=new THREE.Vector3(role.includes('ForeArm')?0:1,0,role.includes('ForeArm')?1:0).applyQuaternion(new THREE.Quaternion(...joint.rotation).invert());
  clip.tracks[id]=Array.from({length:91},(_,i)=>{const time=i/30,start=role.startsWith('Left')?0:1.5,phase=Math.max(0,Math.min(1,(time-start)/1.5)),angle=Math.sin(phase*Math.PI)*Math.PI/4;return {time,position:[0,0,0],rotation:new THREE.Quaternion().setFromAxisAngle(axis,angle).toArray(),interpolation:'LINEAR'};});
 }
 clip.provenance={model:'local-rig-check',prompt:'Local bend test for reviewing joint placement and mesh weights. No AI generation.',seed:0};return clip;
}
