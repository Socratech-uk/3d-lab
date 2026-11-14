import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check,text} from './core.mjs';
import {bodyMapReport,bodySignature,FACINGS,turnPosition} from './action-anatomy.mjs';
import {createRig,applyPose,solveIK,constrainedPose} from './action-geometry.mjs';

export const EQUIPMENT_LIMITS=Object.freeze({items:32,events:512});
export const EQUIPMENT_CATEGORIES=Object.freeze({carry:'Carried item',pistol:'Pistol',rifle:'Rifle',sword:'Sword',knife:'Knife',axe:'Axe / hammer',spear:'Spear / staff',bow:'Bow',shield:'Shield'});
export const EQUIPMENT_ACTIONS=Object.freeze(['equip','hold','use','holster']);
export const EQUIPMENT_STATES=Object.freeze(['held','holstered','hidden']);
const uid=p=>p+'-'+crypto.randomUUID(),object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const number=(v,min,max)=>{check(typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max,'Equipment contains an invalid number.');return v;};
const id=v=>{check(typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v),'Invalid equipment identifier.');return v;};
const vector=(v,min=-100,max=100)=>{check(Array.isArray(v)&&v.length===3,'Equipment needs a three-number vector.');return v.map(n=>number(n,min,max));};
const rotation=v=>{check(Array.isArray(v)&&v.length===4,'Equipment needs a quaternion.');v=v.map(n=>number(n,-1e6,1e6));const length=Math.hypot(...v);check(length>1e-8,'An equipment rotation cannot be empty.');return v.map(n=>n/length);};
export const defaultEquipment=()=>({version:1,carryLimitKg:25,items:[],events:[]});
export function createEquipmentItem(category='carry',name=''){
 check(Object.hasOwn(EQUIPMENT_CATEGORIES,category),'Choose an equipment category.');
 const presets={carry:[2,[.3,.25,.3]],pistol:[1,[.05,.18,.23]],rifle:[4,[.08,.22,.9]],sword:[1.5,[.07,.9,.04]],knife:[.3,[.04,.28,.03]],axe:[3,[.25,.7,.06]],spear:[3,[.07,1.8,.07]],bow:[1.5,[.08,1.2,.3]],shield:[5,[.55,.7,.08]]},[massKg,dimensions]=presets[category];
 return {id:uid('item'),name:name||EQUIPMENT_CATEGORIES[category],kind:category==='carry'?'item':'weapon',category,massKg,dimensions:[...dimensions],hand:category==='bow'?'left':'auto',state:'holstered',asset:null,sockets:{grip:null,support:null,holster:null},actions:{},reviewSignature:null};
}
export function normalizeEquipment(value,joints,clips){
 check(object(value)&&value.version===1,'Unsupported equipment recipe.');check(Array.isArray(value.items)&&value.items.length<=EQUIPMENT_LIMITS.items,'Keep at most 32 equipment items.');check(Array.isArray(value.events)&&value.events.length<=EQUIPMENT_LIMITS.events,'Keep at most 512 equipment state markers.');
 const jointIds=new Set(joints.map(j=>j.id)),clipById=new Map(clips.map(c=>[c.id,c])),ids=new Set();
 const socket=v=>{if(v==null)return null;check(object(v)&&jointIds.has(v.joint),'An equipment socket refers to a missing joint.');return {joint:id(v.joint),position:vector(v.position),rotation:rotation(v.rotation)};};
 const items=value.items.map(item=>{check(object(item),'Invalid equipment item.');const itemId=id(item.id);check(!ids.has(itemId),'Equipment identifiers must be unique.');ids.add(itemId);check(Object.hasOwn(EQUIPMENT_CATEGORIES,item.category)&&item.kind===(item.category==='carry'?'item':'weapon'),'Choose a valid item or weapon category.');check(['auto','right','left','both'].includes(item.hand)&&EQUIPMENT_STATES.includes(item.state),'Choose a hand and initial equipment state.');check(object(item.sockets)&&object(item.actions),'Equipment needs sockets and action bindings.');
  const actions={};for(const [action,clip]of Object.entries(item.actions)){check(EQUIPMENT_ACTIONS.includes(action)&&clipById.has(clip),'An equipment action refers to a missing clip.');actions[action]=id(clip);}
  let asset=null;if(item.asset!=null){check(object(item.asset),'Invalid equipment asset reference.');asset={id:id(item.asset.id),...(item.asset.revision==null?{}:{revision:id(item.asset.revision)})};}
  check(item.reviewSignature==null||typeof item.reviewSignature==='string'&&/^[0-9a-f]{16}$/.test(item.reviewSignature),'Invalid equipment rig signature.');
  return {id:itemId,name:text(item.name,120,true),kind:item.kind,category:item.category,massKg:number(item.massKg,0,10000),dimensions:vector(item.dimensions,.001,100),hand:item.hand,state:item.state,asset,sockets:{grip:socket(item.sockets.grip),support:socket(item.sockets.support),holster:socket(item.sockets.holster)},actions,reviewSignature:item.reviewSignature||null};
 });
 const eventIds=new Set();const events=value.events.map(e=>{check(object(e)&&ids.has(e.item)&&clipById.has(e.clip)&&EQUIPMENT_STATES.includes(e.state),'Equipment marker needs an existing item, clip and state.');const eventId=id(e.id);check(!eventIds.has(eventId),'Equipment marker identifiers must be unique.');eventIds.add(eventId);return {id:eventId,item:id(e.item),clip:id(e.clip),time:number(e.time,0,clipById.get(e.clip).duration),state:e.state};}).sort((a,b)=>a.clip.localeCompare(b.clip)||a.time-b.time||a.id.localeCompare(b.id));
 const positions=new Set();for(const e of events){const key=e.item+'|'+e.clip+'|'+e.time;check(!positions.has(key),'An item can change state only once at the same time.');positions.add(key);}
 return {version:1,carryLimitKg:number(value.carryLimitKg,.1,10000),items,events};
}
export function pruneEquipment(doc){if(!doc.equipment)return;const jointIds=new Set(doc.joints.map(j=>j.id)),clips=new Map(doc.clips.map(c=>[c.id,c]));for(const item of doc.equipment.items){for(const key of ['grip','support','holster'])if(item.sockets[key]&&!jointIds.has(item.sockets[key].joint)){item.sockets[key]=null;item.reviewSignature=null;}for(const [action,clip]of Object.entries(item.actions))if(!clips.has(clip))delete item.actions[action];}const items=new Set(doc.equipment.items.map(i=>i.id));doc.equipment.events=doc.equipment.events.filter(e=>items.has(e.item)&&clips.has(e.clip)&&e.time<=clips.get(e.clip).duration);}
export function trimEquipmentClip(doc,clipId,duration){if(doc.equipment)doc.equipment.events=doc.equipment.events.filter(e=>e.clip!==clipId||e.time<=duration);}
export function duplicateEquipmentClip(doc,sourceId,newId){if(doc.equipment)doc.equipment.events.push(...doc.equipment.events.filter(e=>e.clip===sourceId).map(e=>({...e,id:uid('equipment-event'),clip:newId})));}
export function equipmentStateAt(equipment,item,clipId,time){let state=item.state,last=-Infinity;for(const e of equipment?.events||[])if(e.item===item.id&&e.clip===clipId&&e.time<=time&&e.time>=last){state=e.state;last=e.time;}return state;}
export function reverseEquipmentClip(doc,clipId,duration){
 if(!doc.equipment)return;const kept=doc.equipment.events.filter(e=>e.clip!==clipId),fresh=[];
 for(const item of doc.equipment.items){const events=doc.equipment.events.filter(e=>e.clip===clipId&&e.item===item.id).sort((a,b)=>a.time-b.time);if(!events.length)continue;
  fresh.push({id:uid('equipment-event'),clip:clipId,item:item.id,time:0,state:equipmentStateAt(doc.equipment,item,clipId,duration)});
  for(let i=events.length-1;i>=0;i--){const time=duration-events[i].time;if(time<=0||events[i].time===0)continue;fresh.push({id:uid('equipment-event'),clip:clipId,item:item.id,time,state:i?events[i-1].state:item.state});}
 }
 doc.equipment.events=[...kept,...fresh];
}
/** Rebind metadata to independently baked movement clips. Stateful placement is
 * sampled at each new start, then timing follows the same trim/seam transform. */
export function bakeEquipmentForClips(equipment,mappings){
 if(!equipment)return undefined;const result=structuredClone(equipment);result.events=[];
 for(const item of result.items){const oldActions=item.actions;item.actions={};for(const [action,source]of Object.entries(oldActions)){const mapping=mappings.find(m=>m.source===source);if(mapping)item.actions[action]=mapping.target;}}
 for(const mapping of mappings){const {source,target,from,to,fade=0,loop=true}=mapping,duration=to-from-fade,origin=from+fade;
  check(duration>=.05-1e-6,'Keep at least 0.05 seconds of equipment motion.');
  for(const item of result.items){const events=equipment.events.filter(e=>e.item===item.id&&e.clip===source).sort((a,b)=>a.time-b.time);if(!events.length)continue;
   const start=equipmentStateAt(equipment,item,source,loop?origin:from),states=new Map([[0,start]]);
   for(const event of events){if(event.time<from||event.time>to||loop&&event.time>=to-1e-7)continue;let time=loop?((event.time-origin)%duration+duration)%duration:event.time-from;if(Math.abs(time)<1e-7)time=0;states.set(time,event.state);}
   let previous=item.state;for(const [time,state]of [...states].sort((a,b)=>a[0]-b[0])){if(state===previous)continue;result.events.push({id:uid('equipment-event'),item:item.id,clip:target,time,state});previous=state;}
  }
 }
 return result;
}
export function carryAssessment(item,carryLimitKg=25){
 const requiredTwo=['rifle','spear','bow'].includes(item.category),sizeTwo=item.category==='carry'&&Math.max(...item.dimensions)>.65;
 const heavy=item.massKg>Math.min(5,carryLimitKg*.25),twoHands=item.hand==='both'||requiredTwo||item.hand==='auto'&&(heavy||sizeTwo);
 const primary=item.hand==='left'?'Left':'Right',ok=item.massKg<=carryLimitKg;
 return {ok,twoHands,primary,ratio:item.massKg/carryLimitKg,message:!ok?`${item.massKg} kg exceeds this character’s ${carryLimitKg} kg carrying limit.`:`${twoHands?'Two-hand':'One-hand'} ${item.kind==='weapon'?'grip':'carry'} · ${item.massKg} / ${carryLimitKg} kg. Weight is an authoring rule, not a physics or strength simulation.`};
}
function bodyContext(doc){
 check(doc.bodyMap,'Review a humanoid body map before predicting equipment grips.');const report=bodyMapReport(doc.joints,doc.bodyMap);check(report.ok,report.issues.join(' '));check(doc.bodyMap.kind==='humanoid','Equipment starters currently need a humanoid body map.');
 const facing=FACINGS[doc.bodyMap.facing],byId=new Map(doc.joints.map(j=>[j.id,j])),roles=doc.bodyMap.roles,p=role=>new THREE.Vector3(...turnPosition(byId.get(roles[role]).position,-facing)),positions=doc.joints.map(j=>turnPosition(j.position,-facing)),height=Math.max(...positions.map(p=>p[1]))-Math.min(...positions.map(p=>p[1]));
 check(height>1e-5,'This skeleton has no useful body height.');return {facing,byId,roles,height,p,hips:p('Hips'),chest:p(roles.Chest?'Chest':'Spine'),world:position=>new THREE.Vector3(...turnPosition(position.toArray(),facing))};
}
export function predictEquipmentSockets(doc,item,carryLimitKg=25){
 const b=bodyContext(doc),assessment=carryAssessment(item,carryLimitKg);check(assessment.ok,assessment.message);const primary=assessment.primary,other=primary==='Left'?'Right':'Left',sign=primary==='Left'?1:-1;
 const socket=(role,offset)=>({joint:b.roles[role],position:new THREE.Vector3(...turnPosition(offset,b.facing)).applyQuaternion(new THREE.Quaternion(...b.byId.get(b.roles[role]).rotation).invert()).toArray(),rotation:[0,0,0,1]});
 const back=['rifle','bow','spear','shield'].includes(item.category),holster=socket(back?(b.roles.Chest?'Chest':'Spine'):'Hips',back?[0,0,-b.height*.10]:[sign*b.height*.12,-b.height*.05,0]);
 // Socket rotations are bone-local. The hold builder explicitly orients the wrist
 // in model space, so a neutral grip follows the item’s authored forward axis.
 holster.rotation=new THREE.Quaternion(...b.byId.get(holster.joint).rotation).invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),b.facing)).toArray();
 return {sockets:{grip:socket(primary+'Hand',[0,0,0]),support:assessment.twoHands?socket(other+'Hand',[0,0,0]):null,holster},reviewSignature:bodySignature(doc.joints,doc.bodyMap),assessment};
}
function targets(b,item,assessment){
 const {height:h,chest,hips}=b,sign=assessment.primary==='Left'?1:-1,w=Math.min(item.dimensions[0]*.5,h*.21),primary=new THREE.Vector3(sign*(assessment.twoHands?w:h*.14),chest.y-h*.12,chest.z+h*.19),support=new THREE.Vector3(-sign*w,primary.y,primary.z);
 if(item.category==='rifle'){primary.set(sign*h*.10,chest.y-h*.035,chest.z+h*.16);support.set(-sign*h*.025,primary.y-h*.025,primary.z+Math.min(item.dimensions[2]*.32,h*.2));}
 if(item.category==='pistol'){primary.set(sign*h*.08,chest.y-h*.015,chest.z+h*.28);support.copy(primary).add(new THREE.Vector3(-sign*h*.025,-h*.02,-h*.02));}
 if(item.category==='bow'){primary.set(sign*h*.28,chest.y+h*.03,chest.z+h*.2);support.set(0,chest.y+h*.03,chest.z+h*.04);}
 if(['sword','knife','axe','spear','shield'].includes(item.category)){primary.set(sign*h*.15,chest.y-h*.15,chest.z+h*.19);support.copy(primary).add(new THREE.Vector3(0,-Math.min(item.dimensions[1]*.14,h*.12),0));}if(item.category==='spear')support.copy(primary).add(new THREE.Vector3(0,0,Math.min(item.dimensions[1]*.14,h*.12)));
 const holsterJoint=b.byId.get(item.sockets.holster.joint),holster=new THREE.Vector3(...item.sockets.holster.position).applyQuaternion(new THREE.Quaternion(...holsterJoint.rotation)).add(new THREE.Vector3(...holsterJoint.position));
 return {primary,support,holster:new THREE.Vector3(...turnPosition(holster.toArray(),-b.facing)),holsterRotation:new THREE.Quaternion(...holsterJoint.rotation).multiply(new THREE.Quaternion(...item.sockets.holster.rotation)),rest:b.p(assessment.primary+'Hand'),restOther:b.p(assessment.primary==='Left'?'RightHand':'LeftHand')};
}
/** Real constrained arm keys on the existing rig. These starters use geometry and
 * IK; no model is invoked and no bone, skin weight, or rest transform is edited. */
export function buildEquipmentAction(doc,item,action,{duration=null,carryLimitKg=doc.equipment?.carryLimitKg||25}={}){
 check(EQUIPMENT_ACTIONS.includes(action),'Choose equip, hold, use or holster.');const b=bodyContext(doc),assessment=carryAssessment(item,carryLimitKg);check(assessment.ok,assessment.message);check(item.sockets.grip&&item.sockets.holster,'Predict or set the grip and holster sockets first.');check(item.reviewSignature===bodySignature(doc.joints,doc.bodyMap),'The rig changed. Predict the equipment sockets again.');
 const primaryId=b.roles[assessment.primary+'Hand'],supportId=b.roles[assessment.primary==='Left'?'RightHand':'LeftHand'];check(item.sockets.grip.joint===primaryId,'Starter actions need the grip on the selected primary hand.');if(assessment.twoHands)check(item.sockets.support?.joint===supportId,'Starter actions need the support grip on the opposite hand. Predict grips again.');
 const chainLength=end=>{const side=end===primaryId?assessment.primary:(assessment.primary==='Left'?'Right':'Left'),upper=b.roles[side+'Arm'];let joint=b.byId.get(end),length=0;while(joint?.parent&&length<64){length++;joint=b.byId.get(joint.parent);if(joint?.id===upper)return length;}throw new Error('Map the upper arm above its hand before building equipment actions.');};
 const durationValue=duration??({equip:1.4,hold:2,use:item.category==='rifle'||item.category==='pistol'?.8:1.4,holster:1.4}[action]);number(durationValue,.2,30);
 const clip={id:uid('clip'),name:(item.name+' · '+({equip:'Equip',hold:'Hold',use:item.category==='carry'?'Present / use':'Use',holster:'Holster'}[action])).slice(0,120),duration:durationValue,fps:30,loop:action==='hold',tracks:{},provenance:null};
 const rig=createRig(doc),t=targets(b,item,assessment),count=Math.ceil(durationValue*30),ids=new Set(),orientation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),b.facing),poses={};if(item.category==='spear')orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));let maxError=0;
 const smooth=v=>v*v*(3-2*v),mix=(a,c,v)=>a.clone().lerp(c,smooth(THREE.MathUtils.clamp(v,0,1)));
 function aim(id,target,q){const socket=id===primaryId?item.sockets.grip:item.sockets.support,handQ=q.clone().multiply(new THREE.Quaternion(...socket.rotation).invert()),contact=b.world(target),wrist=contact.clone().sub(new THREE.Vector3(...socket.position).applyQuaternion(handQ));solveIK(rig,doc,poses,id,wrist,chainLength(id));const joint=b.byId.get(id),bone=rig.bones.get(id),local=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQ),delta=rig.rest.get(id).rotation.clone().invert().multiply(local);if(!joint.locked)poses[id]=constrainedPose(joint,{position:[0,0,0],rotation:delta.toArray()});applyPose(rig,doc,poses);maxError=Math.max(maxError,new THREE.Vector3(...socket.position).applyMatrix4(bone.matrixWorld).distanceTo(contact));}
 try{for(let frame=0;frame<=count;frame++){
  const time=Math.min(durationValue,frame/30),u=time/durationValue;let p=t.primary.clone(),s=t.support.clone(),q=orientation.clone();
  // Start each frame from rest so a looping hold has an exact first/last pose.
  for(const key of Object.keys(poses))delete poses[key];applyPose(rig,doc,poses);
  if(action==='equip'){p=u<.38?mix(t.rest,t.holster,u/.38):mix(t.holster,t.primary,(u-.38)/.62);s=mix(t.restOther,t.support,Math.max(0,(u-.38)/.62));q=t.holsterRotation.clone().slerp(orientation,smooth(THREE.MathUtils.clamp((u-.38)/.62,0,1)));}
  else if(action==='holster'){p=u<.62?mix(t.primary,t.holster,u/.62):mix(t.holster,t.rest,(u-.62)/.38);s=mix(t.support,t.restOther,u/.75);q=orientation.clone().slerp(t.holsterRotation,smooth(THREE.MathUtils.clamp(u/.62,0,1)));}
  else if(action==='use'){
   const swing=Math.sin(Math.PI*u),strike=Math.sin(Math.PI*2*u),h=b.height,sign=assessment.primary==='Left'?1:-1;
   if(['pistol','rifle'].includes(item.category)){const recoil=Math.max(0,1-Math.abs(u-.35)/.14);p.z-=h*.035*recoil;p.y+=h*.018*recoil;s.z-=h*.035*recoil;q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-.12*recoil));}
   else if(['sword','axe','knife'].includes(item.category)){p.x+=sign*h*.15*strike;p.y+=h*.20*swing;p.z+=h*.12*swing;q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.9*strike,0,sign*.7*strike)));s.y+=h*.08*swing;}
   else if(item.category==='spear'){p.z+=h*.2*swing;s.z+=h*.2*swing;}
   else if(item.category==='bow'){s.z-=h*.12*swing;}
   else if(item.category==='shield'){p.z+=h*.08*swing;p.y+=h*.07*swing;}
   else{p.y+=h*.06*swing;p.z+=h*.06*swing;s.y+=h*.06*swing;s.z+=h*.06*swing;}
  }
  aim(primaryId,p,q);if(assessment.twoHands)aim(supportId,s,orientation.clone());
  for(const joint of doc.joints){if(!poses[joint.id])continue;ids.add(joint.id);(clip.tracks[joint.id]||=[]).push({time,position:[...poses[joint.id].position],rotation:[...poses[joint.id].rotation],interpolation:'LINEAR'});}
 }
 }finally{rig.skeleton.dispose();}
 check(ids.size,'This rig’s arms are locked or fixed. Unlock the arm joints before generating an equipment starter.');
 const events=[{id:uid('equipment-event'),clip:clip.id,item:item.id,time:0,state:action==='equip'?'holstered':'held'}];if(action==='equip'||action==='holster')events.push({id:uid('equipment-event'),clip:clip.id,item:item.id,time:Math.round(durationValue*(action==='equip'?.38:.62)*30)/30,state:action==='equip'?'held':'holstered'});
 return {clip,events,assessment,maxError,warnings:[...(maxError>b.height*.06?['Some targets are outside the arm’s reach. Review bends and adjust item dimensions or grip placement.']:[]),'Preview hand contact and body clearance. Fingers and collision avoidance are not generated.']};
}
export function equipmentPrompt(item,action='use'){check(EQUIPMENT_ACTIONS.includes(action),'Choose an equipment action.');return `A person ${action==='equip'?'smoothly drawing and equipping':action==='holster'?'carefully stowing':action==='hold'?'standing steadily while holding':'performing one controlled action with'} ${item.name}, a ${EQUIPMENT_CATEGORIES[item.category].toLowerCase()}, using ${item.hand==='both'||['rifle','bow','spear'].includes(item.category)?'both hands':'the '+(item.hand==='left'?'left':'right')+' hand'}. The item weighs ${item.massKg} kilograms. Feet stay planted; natural arm bends, clear hand contact, full body visible. ${action==='hold'?'A seamless idle loop.':'Return to a stable stance.'}`;}
