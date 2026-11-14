import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check} from './core.mjs';
import {bakeGameClip,crossedGameEvents} from './action-game-data.mjs';
import {sampleClip,identityPose} from './action-geometry.mjs';
import {bakeEquipmentForClips} from './action-equipment.mjs';
import {normalizeActionDocument} from './action-document.mjs';

export const MOVEMENT_ROLES=Object.freeze([
 ['idle','Idle','A breathing or resting loop. Rest pose is used when empty.'],
 ['walk','Walk','Choose a steady walk; trim to a clean stride.'],
 ['run','Run','Used while Shift is held. Falls back to Walk.'],
 ['start','Start moving','Optional one-shot from rest into movement.'],
 ['stop','Come to rest','Optional one-shot from motion into a settled pose.'],
 ['back','Walk backward','Optional for strafe / first-person control.'],
 ['left','Strafe left','Optional side-step loop.'],
 ['right','Strafe right','Optional side-step loop.'],
 ['crouch','Crouched idle','Optional crouched resting loop.'],
 ['crouchWalk','Crouch walk','Optional low walking loop.'],
 ['prone','Prone idle','Optional lying-down resting loop.'],
 ['crawl','Crawl','Optional crawling loop.'],
 ['jump','Take-off','Optional jump take-off one-shot.'],
 ['fall','Falling','Optional airborne loop.'],
 ['land','Landing','Optional landing one-shot.'],
 ['turnLeft','Turn left','Optional turn-on-the-spot one-shot.'],
 ['turnRight','Turn right','Optional turn-on-the-spot one-shot.']
]);
export const ONE_SHOT_ROLES=Object.freeze(['start','stop','jump','land','turnLeft','turnRight']);
const n=(v,lo,hi,label)=>{check(typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi,`${label} must be between ${lo} and ${hi}.`);return v;};
export function defaultMovement(){return {version:1,slots:{},height:1.8,walkSpeed:1.5,runSpeed:4.5,acceleration:5,braking:7,turnSpeed:360,blend:.22,seam:.12,steering:'travel',removeRootYaw:true,look:{head:null,chest:null,leftHand:null,rightHand:null,enabled:true,arms:false,weight:.65,armWeight:1}};}
export function normalizeMovement(value,clips,joints) {
 check(value&&value.version===1,'Unsupported game movement settings.');const d=defaultMovement();
 check(value.slots&&typeof value.slots==='object'&&!Array.isArray(value.slots),'Invalid movement slots.');
 const slots={};for(const [role]of MOVEMENT_ROLES){const s=value.slots[role];if(s==null)continue;const clip=clips.find(c=>c.id===s.clip);check(clip,'A movement slot refers to a missing action.');check(Object.values(clip.tracks).some(k=>k.length),'Assign an action with pose keys.');if(clip.game)check(clip.loop!==ONE_SHOT_ROLES.includes(role),'This slot needs a '+(ONE_SHOT_ROLES.includes(role)?'one-shot':'loop')+' action. Change Playback in Game movement first.');const from=n(s.from,0,clip.duration,'Trim start'),to=n(s.to,0,clip.duration,'Trim end');check(to-from>=.05-1e-6,'Keep at least 0.05 seconds in each movement slot.');slots[role]={clip:clip.id,from,to};}
 const profile={version:1,slots,height:n(value.height??d.height,.1,20,'Character height'),walkSpeed:n(value.walkSpeed??d.walkSpeed,.1,20,'Walk speed'),runSpeed:n(value.runSpeed??d.runSpeed,.1,40,'Run speed'),acceleration:n(value.acceleration??d.acceleration,.1,60,'Acceleration'),braking:n(value.braking??d.braking,.1,60,'Braking'),turnSpeed:n(value.turnSpeed??d.turnSpeed,10,1440,'Turn speed'),blend:n(value.blend??d.blend,.03,2,'Transition time'),seam:n(value.seam??d.seam,0,1,'Loop smoothing'),steering:value.steering??d.steering,removeRootYaw:value.removeRootYaw!==false,look:{}};
 check(profile.runSpeed>=profile.walkSpeed,'Run speed must be at least the walk speed.');check(['travel','strafe'].includes(profile.steering),'Choose face-travel or strafe steering.');
 const look=value.look??d.look;check(look&&typeof look==='object'&&!Array.isArray(look),'Invalid look controls.');
 for(const role of ['head','chest','leftHand','rightHand']){const id=look[role]??null;check(id===null||joints.some(j=>j.id===id),'A look control refers to a missing joint.');profile.look[role]=id;}
 const mapped=Object.values(profile.look).filter(Boolean);check(new Set(mapped).size===mapped.length,'Use a different joint for each look / hand control.');
 profile.look.enabled=look.enabled!==false;profile.look.arms=look.arms===true;profile.look.weight=n(look.weight??d.look.weight,0,1,'Look influence');profile.look.armWeight=n(look.armWeight??1,0,1,'Arm aim influence');return profile;
}
export function pruneMovement(doc){
 if(!doc.movement)return;const value=doc.movement;
 for(const [role,s]of Object.entries(value.slots)){const c=doc.clips.find(c=>c.id===s.clip);if(!c||!Object.values(c.tracks).some(k=>k.length)||s.from>=c.duration-.05)delete value.slots[role];else s.to=Math.min(s.to,c.duration);}
 for(const key of ['head','chest','leftHand','rightHand'])if(!doc.joints.some(j=>j.id===value.look[key]))value.look[key]=null;
}
export function suggestMovement(doc){
 const value=defaultMovement(),key=name=>name.toLowerCase().replace(/[^a-z]/g,'');
 const patterns={crouchWalk:/crouch.*walk|walk.*crouch/,crouch:/crouch/,prone:/prone|lying/,crawl:/crawl/,jump:/jump|take.off/,fall:/fall|airborne/,land:/land/,turnLeft:/turn.*left/,turnRight:/turn.*right/,idle:/idle|stand|rest/,walk:/walk|trot/,run:/run|sprint|gallop/,start:/start|begin/,stop:/stop|brak|settle|come.*rest/,back:/backward|backpedal/,left:/strafe.*left|sidestep.*left/,right:/strafe.*right|sidestep.*right/};
 const used=new Set();for(const role of ['crouchWalk','crawl','prone','crouch','jump','fall','land','turnLeft','turnRight','start','stop','back','left','right','idle','run','walk']){const c=doc.clips.find(c=>!used.has(c.id)&&Object.values(c.tracks).some(k=>k.length)&&patterns[role].test(c.name.toLowerCase()));if(c){value.slots[role]={clip:c.id,from:0,to:c.duration};used.add(c.id);}}
 for(const role of ['head','chest','leftHand','rightHand'])value.look[role]=doc.joints.find(j=>key(j.name).replace(/^mixamorig/,'')===key(role))?.id??null;
 return value;
}
export function blendPoses(a,b,t,joints){const result={};for(const j of joints){const x=a[j.id]||identityPose(),y=b[j.id]||identityPose();result[j.id]={position:x.position.map((v,i)=>v+(y.position[i]-v)*t),rotation:new THREE.Quaternion(...x.rotation).slerp(new THREE.Quaternion(...y.rotation),t).toArray()};}return result;}
export function bakeMovementDocument(doc,profile){
 const controller=new MovementController(doc,profile),clips=[],equipmentMappings=[],movement=structuredClone(controller.profile);movement.slots={};let count=0;
 for(const [role,label]of MOVEMENT_ROLES){const slot=controller.slot(role);if(!slot)continue;const source=doc.clips.find(c=>c.id===slot.clip),loop=!ONE_SHOT_ROLES.includes(role),length=slot.to-slot.from,duration=loop?length-Math.min(profile.seam,length*.25,Math.max(0,length-.05)):length,fps=source.fps,steps=Math.ceil(duration*fps);count+=(steps+1)*doc.joints.length;check(count<=180000,'These movement slots exceed the export key limit. Shorten the trimmed ranges or use fewer slots.');const clip={id:'movement-'+role,name:label,duration,fps,loop,tracks:{},provenance:source.provenance?structuredClone(source.provenance):null};
  for(let i=0;i<=steps;i++){const time=Math.min(duration,i/fps),pose=controller.sample(role,loop?time/duration:time,loop);for(const joint of doc.joints){const value=pose[joint.id]||identityPose();(clip.tracks[joint.id]||=[]).push({time,position:[...value.position],rotation:[...value.rotation],interpolation:'LINEAR'});}}
  if(source.game)clip.game=bakeGameClip(source.game,{from:slot.from,to:slot.to,fade:loop?length-duration:0,loop,sourceDuration:source.duration});
  equipmentMappings.push({source:source.id,target:clip.id,from:slot.from,to:slot.to,fade:loop?length-duration:0,loop});clips.push(clip);movement.slots[role]={clip:clip.id,from:0,to:duration};
 }
 check(clips.length,'Assign at least one keyed action before exporting game clips.');
 // Seam smoothing was already baked into the new clips; consumers must not do
 // it a second time. World travel still belongs to the receiving controller.
 movement.seam=0;return normalizeActionDocument({...doc,clips,movement,...(doc.equipment?{equipment:bakeEquipmentForClips(doc.equipment,equipmentMappings)}:{})});
}
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const smooth=t=>t*t*(3-2*t);
export class MovementController {
 constructor(doc,profile){this.doc=doc;this.profile=normalizeMovement(profile,doc.clips,doc.joints);this.roots=doc.joints.filter(j=>j.parent===null);this.eventClips={};for(const [role,s]of Object.entries(this.profile.slots)){const c=doc.clips.find(c=>c.id===s.clip);if(c.game)this.eventClips[role]=bakeGameClip(c.game,{from:s.from,to:s.to,fade:ONE_SHOT_ROLES.includes(role)?0:this.duration(role)-this.cycleDuration(role),loop:!ONE_SHOT_ROLES.includes(role)});}this.reset();}
 reset(){this.position=new THREE.Vector3();this.velocity=new THREE.Vector3();this.yaw=0;this.phase=0;this.cycles=0;this.eventRole=null;this.eventTime=0;this.clock=0;this.state='idle';this.stateTime=0;this.hadInput=false;this.pose={};this.previous={};this.transition=1;this.weights={idle:1};this.distance=0;}
 slot(role){return this.profile.slots[role];}
 duration(role){const s=this.slot(role);return s?s.to-s.from:0;}
 cycleDuration(role){const d=this.duration(role);return d-Math.min(this.profile.seam,d*.25,Math.max(0,d-.05));}
 interruptible(role){const s=this.slot(role);return !s||this.doc.clips.find(c=>c.id===s.clip)?.game?.interruptible!==false;}
 calibratedSpeed(role){const s=this.slot(role),c=s&&this.doc.clips.find(c=>c.id===s.clip);return c?.game?.strideLength?c.game.strideLength*this.duration(role)/c.duration/Math.max(.05,this.cycleDuration(role)):null;}
 sample(role,time,loop=false){
  const s=this.slot(role);if(!s)return {};const clip=this.doc.clips.find(c=>c.id===s.clip),length=s.to-s.from,fade=loop?Math.min(this.profile.seam,length*.25,Math.max(0,length-.05)):0;
  const t=loop?s.from+fade+(time%1+1)%1*(length-fade):Math.min(s.to,s.from+Math.max(0,time));
  let pose=sampleClip(clip,t);
  if(fade>0&&t>s.to-fade)pose=blendPoses(pose,sampleClip(clip,s.from+t-(s.to-fade)),smooth((t-s.to+fade)/fade),this.doc.joints);
  // Controller owns world X/Z travel. Keep vertical motion and all source keys.
  for(const root of this.roots){const p=pose[root.id];if(!p)continue;p.position[0]=0;p.position[2]=0;if(this.profile.removeRootYaw){const rest=new THREE.Quaternion(...root.rotation),q=rest.clone().multiply(new THREE.Quaternion(...p.rotation)).multiply(rest.clone().invert()),twist=new THREE.Quaternion(0,q.y,0,q.w);if(twist.lengthSq()>1e-10){twist.normalize();q.premultiply(twist.invert());p.rotation=rest.clone().invert().multiply(q).multiply(rest).normalize().toArray();}}}
  return pose;
 }
 changeState(next){if(next===this.state)return;this.previous=this.pose;this.state=next;this.stateTime=0;this.transition=0;}
 update(dt,input={}){
  dt=Math.max(0,Math.min(.05,dt));const p=this.profile,forward=THREE.MathUtils.clamp(input.forward||0,-1,1),right=THREE.MathUtils.clamp(input.right||0,-1,1),length=Math.hypot(forward,right),moving=length>.01,lookYaw=input.yaw||0,strafe=input.strafe??p.steering==='strafe';
  const target=new THREE.Vector3(Math.sin(lookYaw)*forward-Math.cos(lookYaw)*right,0,Math.cos(lookYaw)*forward+Math.sin(lookYaw)*right);
  if(target.lengthSq()>1)target.normalize();target.multiplyScalar(input.run?p.runSpeed:p.walkSpeed);
  const diff=target.clone().sub(this.velocity),limit=(moving?p.acceleration:p.braking)*dt;
  if(diff.length()<=limit)this.velocity.copy(target);else this.velocity.add(diff.setLength(limit));
  this.position.addScaledVector(this.velocity,dt);this.distance+=this.velocity.length()*dt;
  const desiredYaw=strafe?lookYaw:moving?Math.atan2(target.x,target.z):this.yaw;
  this.yaw+=THREE.MathUtils.clamp(angle(desiredYaw-this.yaw),-p.turnSpeed*Math.PI/180*dt,p.turnSpeed*Math.PI/180*dt);
  const locked=['start','stop'].includes(this.state)&&!this.interruptible(this.state)&&this.stateTime<this.duration(this.state);
  if(!locked&&moving&&!this.hadInput)this.changeState(this.slot('start')?'start':'move');
  if(!locked&&!moving&&this.hadInput)this.changeState(this.slot('stop')?'stop':'idle');
  this.hadInput=moving;this.stateTime+=dt;this.clock+=dt;
  if(this.state==='start'&&this.stateTime>=this.duration('start'))this.changeState(moving?'move':'idle');
  if(this.state==='stop'&&this.stateTime>=this.duration('stop'))this.changeState(moving?'move':'idle');
  const speed=this.velocity.length(),walk=this.slot('walk')?'walk':this.slot('run')?'run':'idle',walkWeight=THREE.MathUtils.clamp(speed/p.walkSpeed,0,1),runWeight=this.slot('run')?THREE.MathUtils.clamp((speed-p.walkSpeed)/Math.max(.01,p.runSpeed-p.walkSpeed),0,1):0;
  const cycle=(1-runWeight)*(this.cycleDuration(walk)||1)+runWeight*(this.cycleDuration('run')||1);
  this.cycles+=dt/cycle*THREE.MathUtils.clamp(speed/(p.walkSpeed+(p.runSpeed-p.walkSpeed)*runWeight),0,2.5);this.phase=this.cycles%1;
  const idle=this.sample('idle',this.clock/Math.max(.05,this.cycleDuration('idle')),true);
  let targetPose,role=walk;
  if(['start','stop'].includes(this.state)){targetPose=this.sample(this.state,this.stateTime);this.weights={[this.state]:1};}
  else {
   if(strafe&&moving){if(forward<-.4&&Math.abs(forward)>=Math.abs(right)&&this.slot('back'))role='back';else if(right<-.4&&this.slot('left'))role='left';else if(right>.4&&this.slot('right'))role='right';}
   let gait=this.sample(role,this.phase,true);
   if(role===walk&&runWeight>0)gait=blendPoses(gait,this.sample('run',this.phase,true),runWeight,this.doc.joints);
   targetPose=blendPoses(idle,gait,walkWeight,this.doc.joints);this.weights={idle:1-walkWeight,[role]:walkWeight*(role===walk?1-runWeight:1),...(role===walk?{run:walkWeight*runWeight}:{})};
  }
  this.transition=Math.min(1,this.transition+dt/p.blend);
  // A short exponential blend also smooths direction-slot changes while moving.
  this.pose=this.transition<1?blendPoses(this.previous,targetPose,smooth(this.transition),this.doc.joints):blendPoses(this.pose,targetPose,1-Math.exp(-dt*6/p.blend),this.doc.joints);
  const eventRole=Object.entries(this.weights).sort((a,b)=>b[1]-a[1])[0]?.[0],loop=!ONE_SHOT_ROLES.includes(eventRole),eventTime=eventRole==='idle'?this.clock:loop?this.cycles*Math.max(.05,this.cycleDuration(eventRole)):this.stateTime;const events=crossedGameEvents(this.eventClips[eventRole],this.eventRole===eventRole?this.eventTime:Math.max(0,eventTime-dt),eventTime,Math.max(.05,loop?this.cycleDuration(eventRole):this.duration(eventRole)),{loop,includeStart:this.eventRole!==eventRole});this.eventRole=eventRole;this.eventTime=eventTime;
  return {pose:this.pose,state:this.state,speed,weights:this.weights,position:this.position,yaw:this.yaw,phase:this.phase,events};
 }
}
