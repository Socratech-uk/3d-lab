import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check} from './core.mjs';
import {createRig,applyPose,sampleClip,identityPose} from './action-geometry.mjs';
import {motionRigStatus,bodySignature,FACINGS} from './action-anatomy.mjs';
import {normalizeActionDocument,uid} from './action-document.mjs';
import {defaultGameClip,FOOT_ROLES,normalizeGameClip} from './action-game-data.mjs';
import {retargetMotion} from './action-motion.mjs';
import {inspectActionMotion} from './action-motion-check.mjs';

export function mappedFeet(doc){const status=motionRigStatus(doc);return status.map?FOOT_ROLES.filter(role=>status.map.roles[role]).map(role=>({role,id:status.map.roles[role]})):[];}
export function reviewGameClip(doc,clip,{from=0,to=clip.duration,height=1.8,meshHeight=null}={}){
 check(to>from&&from>=0&&to<=clip.duration,'Choose a valid clip range.');
 const a=sampleClip(clip,from),b=sampleClip(clip,to),messages=[...inspectActionMotion(doc,clip).messages];
 const angles=doc.joints.map(j=>({name:j.name,angle:new THREE.Quaternion(...(a[j.id]||identityPose()).rotation).angleTo(new THREE.Quaternion(...(b[j.id]||identityPose()).rotation))*180/Math.PI})).sort((a,b)=>b.angle-a.angle);
 const h=meshHeight||Math.max(1e-6,Math.max(...doc.joints.map(j=>j.position[1]))-Math.min(...doc.joints.map(j=>j.position[1]))),scale=height/h;
 const root=doc.joints.find(j=>j.parent===null),p=a[root?.id]?.position||[0,0,0],q=b[root?.id]?.position||[0,0,0];
 const distance=Math.hypot(q[0]-p[0],q[2]-p[2])*scale;
 if(clip.loop&&angles[0]?.angle>20)messages.push(`Loop seam: ${angles[0].name} jumps ${angles[0].angle.toFixed(0)}°. Trim a complete cycle or match the endpoints.`);
 if(clip.loop&&Math.abs(q[1]-p[1])*scale>.04)messages.push('Root height differs at the loop ends; check for a vertical pop.');
 if(!mappedFeet(doc).length)messages.push('Map body joints to enable foot-contact suggestions.');
 if(!clip.game?.contacts?.length)messages.push('No foot-contact windows are marked. Add or suggest them, then review the feet.');
 let contactDrift=0;
 if(clip.game?.contacts?.length){const rig=createRig(doc),feet=new Map(mappedFeet(doc).map(f=>[f.role,f.id]));
  try{for(const contact of clip.game.contacts){const id=feet.get(contact.role);if(!id)continue;let first=null;
   for(let i=0;i<=8;i++){const time=contact.from+(contact.to-contact.from)*i/8;applyPose(rig,doc,sampleClip(clip,time));const p=rig.bones.get(id).getWorldPosition(new THREE.Vector3()).multiplyScalar(scale);
    if(distance<.01&&clip.game.strideLength){const direction=new THREE.Vector3(0,0,/backward|backpedal/i.test(clip.name)?-1:1);if(/strafe|sidestep/i.test(clip.name))direction.set(/left/i.test(clip.name)?1:-1,0,0);direction.applyAxisAngle(new THREE.Vector3(0,1,0),FACINGS[doc.bodyMap?.facing||'+Z']);p.addScaledVector(direction,time*clip.game.strideLength/clip.duration);}
    if(!first)first=p.clone();contactDrift=Math.max(contactDrift,Math.hypot(p.x-first.x,p.z-first.z));
   }
  }}finally{rig.skeleton.dispose();}
  if(contactDrift>.06)messages.push(`Marked foot contacts drift by up to ${contactDrift.toFixed(2)} m. Review contact windows and stride speed; markers do not lock the feet.`);
 }
 return {messages,loopAngle:angles[0]?.angle||0,contactDrift,rootDistance:distance,suggestedSpeed:distance/(to-from),duration:to-from};
}

/** Height + vertical velocity proposal only. The user must inspect/apply it. */
export function suggestContacts(doc,clip){
 const feet=mappedFeet(doc);check(feet.length,'Review the humanoid or animal body map before suggesting foot contacts.');
 const rig=createRig(doc),samples=[],steps=Math.min(2400,Math.max(2,Math.ceil(clip.duration*30))),dt=clip.duration/steps;
 try{
  for(let i=0;i<=steps;i++){applyPose(rig,doc,sampleClip(clip,i*dt));samples.push(feet.map(f=>rig.bones.get(f.id).getWorldPosition(new THREE.Vector3()).toArray()));}
  const height=Math.max(1e-6,Math.max(...doc.joints.map(j=>j.position[1]))-Math.min(...doc.joints.map(j=>j.position[1]))),contacts=[];
  for(const [foot,f]of feet.entries()){
   const ys=samples.map(row=>row[foot][1]),min=Math.min(...ys),max=Math.max(...ys),band=Math.max(height*.018,(max-min)*.12);let start=null;
   for(let i=0;i<=steps+1;i++){
    const speed=i<=steps?Math.abs(ys[Math.min(steps,i+1)]-ys[Math.max(0,i-1)])/(i===0||i===steps?dt:2*dt):Infinity;
    const down=i<=steps&&ys[i]<=min+band&&speed<height*.3;
    if(down&&start===null)start=i;
    if(!down&&start!==null){const from=Math.max(0,(start-.5)*dt),to=Math.min(clip.duration,(i-.5)*dt);if(to-from>=.05)contacts.push({id:uid('contact'),role:f.role,from,to});start=null;}
   }
  }
  check(contacts.length<=128,'Too many contact windows. Trim a shorter, steadier action before suggesting contacts.');return contacts;
 }finally{rig.skeleton.dispose();}
}

export function transferMap(source,target){
 const a=motionRigStatus(source),b=motionRigStatus(target);
 check(a.map&&!a.issues.length,'Source action needs a valid, reviewed humanoid or animal body map. '+a.issues.join(' '));
 check(b.map&&!b.issues.length,'Current model needs a valid, reviewed body map. '+b.issues.join(' '));
 check(a.map.kind===b.map.kind,'Transfer needs the same body type. Humanoid and four-legged actions cannot be exchanged.');
 const rows=Object.entries(a.map.roles).filter(([role])=>b.map.roles[role]).map(([role,id])=>({role,source:id,target:b.map.roles[role]}));
 return {source:a,target:b,rows};
}

/** Transfer world deformation (including twist) between reviewed semantic rigs.
 * Bind positions/weights and both source documents remain untouched. */
export function transferGameAction(sourceValue,targetValue,clipId){
 const source=normalizeActionDocument(sourceValue),target=normalizeActionDocument(targetValue),mapping=transferMap(source,target),clip=source.clips.find(c=>c.id===clipId);
 check(clip&&Object.values(clip.tracks).some(k=>k.length),'Choose a source action with keys.');
 const steps=Math.ceil(clip.duration*clip.fps);check((steps+1)*target.joints.length<=180000,'This transfer exceeds the key budget. Shorten the source action.');
 const rig=createRig(source),turn=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),FACINGS[mapping.target.map.facing]-FACINGS[mapping.source.map.facing]),back=turn.clone().invert();
 const ordered=mapping.source.joints,sourceById=new Map(source.joints.map(j=>[j.id,j]));
 const motion={format:'capp.motion.v1',fps:clip.fps,durationSeconds:clip.duration,rotationSpace:'world-rest-delta',joints:ordered.map(j=>({name:j.name,parent:ordered.findIndex(p=>p.id===j.parent),position:new THREE.Vector3(...sourceById.get(j.id).position).applyQuaternion(turn).toArray()})),frames:[]};
 try{
  for(let i=0;i<=steps;i++){
   const time=Math.min(clip.duration,i/clip.fps);applyPose(rig,source,sampleClip(clip,time));
   motion.frames.push({time,positions:ordered.map(j=>rig.bones.get(j.id).getWorldPosition(new THREE.Vector3()).applyQuaternion(turn).toArray()),rotations:ordered.map(j=>turn.clone().multiply(rig.bones.get(j.id).getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion(...sourceById.get(j.id).rotation).invert())).multiply(back).normalize().toArray())});
  }
  const result=retargetMotion(target,motion,{name:clip.name+' · transferred'});result.clip.loop=clip.loop;result.clip.provenance=clip.provenance?structuredClone(clip.provenance):null;
  const game=structuredClone(clip.game||defaultGameClip());game.strideLength=null;game.contacts=game.contacts.filter(c=>mapping.target.map.roles[c.role]);game.transfer={sourceTitle:source.title,sourceAction:clip.name,sourceRig:bodySignature(source.joints,mapping.source.map),targetRig:bodySignature(target.joints,mapping.target.map)};
  result.clip.game=normalizeGameClip(game,clip.duration);return result;
 }finally{rig.skeleton.dispose();}
}
