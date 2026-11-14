/** Shared anatomical motion. Metres, seconds and radians; no renderer dependency.
 * Bind joints never move in source. Posed joints drive complete rigid limb groups,
 * so plates, sleeves and undersuits cannot slide independently of a knee/elbow.
 */
import { CharacterFrame } from './character-frame.js?v=1.0.0';
const TAU = Math.PI * 2;
const clamp = (v,a,b) => Math.max(a,Math.min(b,Number(v)||0));
const add = (a,b) => a.map((x,i)=>x+b[i]);
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const mul = (a,s) => a.map(x=>x*s);
const dot = (a,b) => a.reduce((n,x,i)=>n+x*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = a => mul(a,1/(Math.hypot(...a)||1));
const lerp3 = (a,b,t) => a.map((x,i)=>x+(b[i]-x)*t);
export const HUMANOID_GAIT_RADIANS_PER_METRE = TAU;
export const qIdentity = () => [0,0,0,1];
export const qInverse = q => [-q[0],-q[1],-q[2],q[3]];
export function qMultiply(a,b){const [x,y,z,w]=a,[X,Y,Z,W]=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];}
export function qRotate(q,p){return qMultiply(qMultiply(q,[...p,0]),qInverse(q)).slice(0,3);}
export function qFromXYZ(e){const [x,y,z]=e.map(v=>v/2),a=Math.cos(x),b=Math.sin(x),c=Math.cos(y),d=Math.sin(y),f=Math.cos(z),g=Math.sin(z);return [b*c*f+a*d*g,a*d*f-b*c*g,a*c*g+b*d*f,a*c*f-b*d*g];}
export function qToXYZ(q){const [x,y,z,w]=q,m13=2*(x*z+w*y);return Math.abs(m13)<.9999999?[Math.atan2(2*(w*x-y*z),1-2*(x*x+y*y)),Math.asin(clamp(m13,-1,1)),Math.atan2(2*(w*z-x*y),1-2*(y*y+z*z))]:[Math.atan2(2*(x*w+y*z),1-2*(x*x+z*z)),Math.asin(clamp(m13,-1,1)),0];}
export function qBetween(a,b){a=unit(a);b=unit(b);const d=dot(a,b);if(d<-.999999){const axis=unit(cross(a,Math.abs(a[0])<.8?[1,0,0]:[0,1,0]));return [...axis,0];}const q=[...cross(a,b),1+d],l=Math.hypot(...q)||1;return q.map(x=>x/l);}
export function qSlerp(a,b,t){let d=dot(a,b);if(d<0){b=mul(b,-1);d=-d;}if(d>.9995){const q=lerp3(a,b,t);return mul(q,1/Math.hypot(...q));}const angle=Math.acos(clamp(d,-1,1)),s=Math.sin(angle);return a.map((x,i)=>(x*Math.sin((1-t)*angle)+b[i]*Math.sin(t*angle))/s);}

export function createHumanoidRig(role='pilot',appearance={}){
 const pilot=role==='pilot',hip=Number(appearance.hipScale||1),shoulder=Number(appearance.shoulderScale||1);
 const bones=[{key:'pelvis',parent:null,bind:[0,0,0]},{key:'torso',parent:'pelvis',bind:[0,1.08,0]},{key:'head',parent:'torso',bind:[0,1.68,0]}];
 for(const side of [-1,1]){const p=side<0?'left':'right';
  bones.push({key:p+'Thigh',parent:'pelvis',bind:[side*(pilot?.145:.137*hip),pilot?.985:.975,0]},
   {key:p+'Shin',parent:p+'Thigh',bind:[side*(pilot?.158:.145*hip),.555,0]},
   {key:p+'Foot',parent:p+'Shin',bind:[side*(pilot?.158:.145*hip),.155,pilot?-.012:0]},
   {key:p+'UpperArm',parent:'torso',bind:[side*(pilot?.335:.315*shoulder),pilot?1.585:1.555,.005]},
   {key:p+'Forearm',parent:p+'UpperArm',bind:role==='clerk'?[side*.310,1.315,.145]:[side*(pilot?.365:.338*shoulder),1.285,0]},
   {key:p+'Hand',parent:p+'Forearm',bind:role==='clerk'?[side*.170,1.245,.315]:[side*(pilot?.365:.340*shoulder),pilot?1.015:1.020,0]});
 }
 return {version:1,role,bones};
}

/** Accumulate phase from travelled speed, never elapsed * current speed.
 * No input guess: pushing against a wall does not make the feet run on the spot.
 */
export function advanceHumanoidMotion(memory={}, {dt=0,speed=0,forward=1,lateral=0,grounded=true,armed=false,pace=1}={}){
 const step=clamp(dt,0,.075),actual=Math.max(0,Number(speed)||0),a=1-Math.exp(-12*step);
 memory.weight=(memory.weight||0)+(grounded&&actual>.035?Math.min(1,actual/.55)-(memory.weight||0):-(memory.weight||0))*a;
 memory.armed=(memory.armed||0)+(Number(Boolean(armed))-(memory.armed||0))*a;
 memory.cycle=(memory.cycle||0)+actual*step*HUMANOID_GAIT_RADIANS_PER_METRE*clamp(pace,.2,3);
 memory.speed=actual;memory.grounded=grounded;
 if(actual>.035){const l=Math.hypot(forward,lateral)||1;memory.direction=[lateral/l,forward/l];}
 return {cycle:memory.cycle,motionWeight:memory.weight,aimWeight:memory.armed,moving:memory.weight>.001,speed:actual,grounded,direction:memory.direction||[0,1]};
}
function solveLimb(a,b,c,target,pole){
 const l1=Math.hypot(...sub(b,a)),l2=Math.hypot(...sub(c,b));let delta=sub(target,a),d=Math.hypot(...delta);
 const n=unit(delta);d=clamp(d,Math.abs(l1-l2)+.00001,l1+l2-.00001);target=add(a,mul(n,d));
 const along=(l1*l1-l2*l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along));
 let bend=sub(pole,mul(n,dot(pole,n)));if(Math.hypot(...bend)<.001)bend=cross(n,[1,0,0]);
 return {middle:add(add(a,mul(n,along)),mul(unit(bend),height)),end:target};
}
/** Return local bone transforms. Foot contact follows a 60% stance / 40% swing
 * trajectory; knees solve fixed limb lengths, soles stay parallel to the floor.
 */
export function sampleHumanoidPose(rig,{cycle=0,moving=false,speed=0,motionWeight=moving?1:0,aimWeight=0,aiming=false,grounded=true,direction=[0,1],pitch=0}={}){
 const weight=clamp(motionWeight,0,1),armed=clamp(aimWeight||(aiming?1:0),0,1),map=new Map(rig.bones.map(b=>[b.key,b]));
 const transforms=new Map(rig.bones.map(b=>[b.key,{position:b.parent?sub(b.bind,map.get(b.parent).bind):[...b.bind],rotation:[0,0,0],scale:[1,1,1]}]));
 const pelvisY=grounded?(-.070+Math.cos(cycle*2)*.007)*weight:0;
 transforms.get('pelvis').position[1]+=pelvisY;

 if(Math.abs(pitch)>.00001)transforms.get('head').rotation[0]=clamp(pitch,-.55,.55)*.55;
 for(const side of [-1,1]){
  const p=side<0?'left':'right',phase=((cycle/TAU+(side<0?.5:0))%1+1)%1;
  const hip=map.get(p+'Thigh').bind,knee=map.get(p+'Shin').bind,ankle=map.get(p+'Foot').bind;
  if(weight>.000001&&grounded){
   const stance=.6,swing=(phase-stance)/(1-stance),along=phase<stance?1-2*phase/stance:-Math.cos(swing*Math.PI);
   const lift=phase<stance?0:Math.sin(swing*Math.PI)*(.10+Math.min(.06,speed*.009))*weight;
   const target=add(ankle,[direction[0]*along*.30*weight,lift,direction[1]*along*.30*weight]);
   const h=add(hip,[0,pelvisY,0]),k=add(knee,[0,pelvisY,0]),a=add(ankle,[0,pelvisY,0]);
   const solved=solveLimb(h,k,a,target,[0,0,1]);
   const upper=qBetween(sub(knee,hip),sub(solved.middle,h)),lower=qBetween(sub(ankle,knee),sub(solved.end,solved.middle));
   transforms.get(p+'Thigh').rotation=qToXYZ(upper);
   transforms.get(p+'Shin').rotation=qToXYZ(qMultiply(qInverse(upper),lower));
   transforms.get(p+'Foot').rotation=qToXYZ(qInverse(lower));
  }else if(!grounded){transforms.get(p+'Thigh').rotation[0]=side*.08;transforms.get(p+'Shin').rotation[0]=-.18;transforms.get(p+'Foot').rotation[0]=.10;}
  const shoulder=map.get(p+'UpperArm').bind,elbow=map.get(p+'Forearm').bind,wrist=map.get(p+'Hand').bind;
  const armSwing=Math.sin(cycle+(side>0?Math.PI:0))*.19*weight*(1-armed);
  let target=add(wrist,[0,Math.abs(armSwing)*.15,armSwing]);
  if(armed>0){const grip=side>0?[.20,1.21,.25]:[.0,1.30,.36];target=lerp3(target,grip,armed);}
  if(armed>1e-6||weight>1e-6){
   const solved=solveLimb(shoulder,elbow,wrist,target,[side*.8,-.7,-.2]);
   const upper=qBetween(sub(elbow,shoulder),sub(solved.middle,shoulder)),lower=qBetween(sub(wrist,elbow),sub(solved.end,solved.middle));
   transforms.get(p+'UpperArm').rotation=qToXYZ(upper);
   transforms.get(p+'Forearm').rotation=qToXYZ(qMultiply(qInverse(upper),lower));
   transforms.get(p+'Hand').rotation=qToXYZ(qInverse(lower));
  }
 }
 return transforms;
}
export function humanoidBoneWorld(rig,pose){
 const world=new Map();for(const b of rig.bones){const t=pose.get(b.key),parent=world.get(b.parent),q=qFromXYZ(t.rotation);
 world.set(b.key,{position:parent?add(parent.position,qRotate(parent.quaternion,t.position)):t.position,quaternion:parent?qMultiply(parent.quaternion,q):q});}
 return world;
}
/** Adapter around native draw commands; bind-space source geometry is untouched. */
export function createHumanoidRigRenderer(renderer,frame,rig,pose,scale=1){
 const world=humanoidBoneWorld(rig,pose),bindings=new Map(rig.bones.map(b=>[b.key,b]));
 return key=>{
  const b=bindings.get(key),w=world.get(key);if(!b||!w)throw new Error('Unknown humanoid bone '+key);
  const offset=sub(w.position,qRotate(w.quaternion,b.bind));
  const deformed=new CharacterFrame({origin:frame.point(mul(offset,scale)),right:frame.vector(qRotate(w.quaternion,[1,0,0])),up:frame.vector(qRotate(w.quaternion,[0,1,0])),forward:frame.vector(qRotate(w.quaternion,[0,0,1]))});
  // Native anatomical dimensions are full widths/diameters (e.g. 30.5 cm
  // helmet, 33.5 cm boot). The generic SOL primitive contract is half-extents.
  // Convert here, before both native draw and capture, not in a world renderer.
  const scoped={};for(const method of ['mesh','taper','segment'])scoped[method]=(_root,...args)=>{
   renderer.setBone?.(key);
   if(method==='mesh')args[2]=args[2].map(v=>v*.5);
   if(method==='taper'){args[2]=args[2].map(v=>v*.5);args[3]=args[3].map(v=>v*.5);}
   return renderer[method](deformed,...args);
  };
  scoped.shadow=(...args)=>renderer.shadow?.(...args);return scoped;
 };
}
