/** Shared fictional ship armament contract. SOL metres, +Y up, -Z forward.
 * A socket's size is a ceiling. Small equipment is never stretched to fit.
 * Cadence, magazine, heat and power have one owner here in Designer and play. */
import {applySolWorldPose} from '../model-format/sol-world-components.js?v=1.5.0';
import {qFromXYZ,qRotate} from '../characters/humanoid-motion.js';
export const HARDPOINT_SIZES = Object.freeze([1, 2, 3, 4]);
export const HARDPOINT_DIAMETERS = Object.freeze([0, .48, .76, 1.08, 1.48]);
export const WEAPON_FIELDS = Object.freeze({
 rpm: [1, 2400, 600], damage: [0, 10000, 12], speed: [10, 3000, 600], range: [10, 12000, 1600],
 spread: [0, 10, .3], magazine: [1, 2000, 240], reloadSeconds: [.1, 60, 3],
 heatPerShot: [0, 100, 1], cooling: [0, 100, 18], energyPerShot: [0, 100, 0],
 yaw: [0, 150, 50], pitch: [0, 85, 35], tracking: [1, 360, 100],
 turnRate: [0, 8, 0], splash: [0, 150, 0], shieldMultiplier: [.1, 5, 1], armourPenetration: [0, 1, .05],
});
const preset = (id, name, family, size, patch, description) => Object.freeze({id, name, family, size,
 ...Object.fromEntries(Object.entries(WEAPON_FIELDS).map(([k,v])=>[k,v[2]])),...patch, description});
export const SHIP_WEAPONS = Object.freeze([
 preset('needle', 'Needle · interceptor missile', 'missile', 1, {rpm:40,damage:65,speed:230,range:2400,magazine:1,reloadSeconds:5,turnRate:3.8,splash:5,spread:0,heatPerShot:0}, 'Fast, agile guided interceptor on a gimballed single-round launch shoe.'),
 preset('breaker', 'Breaker · heavy impact missile', 'missile', 2, {rpm:15,damage:260,speed:130,range:3100,magazine:1,reloadSeconds:9,turnRate:1.1,splash:20,armourPenetration:.6,spread:0,heatPerShot:0}, 'Broad-shouldered heavy missile: slow tracking, substantial armour damage.'),
 preset('wisp', 'Wisp · shield disruptor', 'missile', 1, {rpm:30,damage:38,speed:185,range:2600,magazine:1,reloadSeconds:6,turnRate:2.6,splash:9,shieldMultiplier:3.2,spread:0,heatPerShot:0}, 'A shield-biased guided round with a cyan containment core; no invented EMP status effect.'),
 preset('quiver', 'Quiver · four-cell missile rack', 'rack', 2, {rpm:120,damage:65,speed:230,range:2400,magazine:4,reloadSeconds:7,turnRate:3.8,splash:5,spread:0,heatPerShot:0,payload:'needle'}, 'Four indexed launch cells and one integrated gimbal. Choose Needle or Wisp payloads.'),
 preset('ripsaw', 'Ripsaw · rotary ballistic cannon', 'ballistic', 2, {rpm:1800,damage:7,speed:1100,range:1900,magazine:360,reloadSeconds:4,heatPerShot:.7,cooling:24,spread:.45,armourPenetration:.15}, 'Six-barrel rotary cannon, a sculpted receiver and twin feed cassettes. 1,800 RPM.'),
 preset('arc', 'Arc · pulse-energy emitter', 'energy', 2, {rpm:240,damage:32,speed:700,range:2200,magazine:80,reloadSeconds:2.5,heatPerShot:5,cooling:18,energyPerShot:6,shieldMultiplier:1.5,spread:.12}, 'Open ceramic focusing forks around a luminous pulse core, with visible cooling vanes.'),
]);
export const shipWeaponPreset = id => SHIP_WEAPONS.find(w=>w.id===id)||null;
export const shipWeaponAssetId = id => `project:components/ship-weapons/${id}.solmodel.json`;
function bounded(v, min, max, fallback) {if(v===undefined)return fallback;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new TypeError(`Armament value must be ${min}–${max}.`);return v;}
export function normalizeShipHardpoint(value) {
 if(value===undefined)return undefined;
 if(!value||value.version!==1||!HARDPOINT_SIZES.includes(value.size))throw new TypeError('Hardpoint needs version 1 and size S1–S4.');
 return {version:1,size:value.size};
}
export function normalizeShipWeapon(value) {
 if(value===undefined)return undefined;
 if(!value||value.version!==1||!['ballistic','energy','missile','rack'].includes(value.family)||!HARDPOINT_SIZES.includes(value.size))throw new TypeError('Invalid ship weapon family or mounting size.');
 const result={version:1,family:value.family,size:value.size};
 for(const [key,[min,max,def]] of Object.entries(WEAPON_FIELDS))result[key]=bounded(value[key],min,max,def);
 result.magazine=Math.round(result.magazine);
 if(value.family==='rack'){if(value.payload!==undefined&&!['needle','wisp'].includes(value.payload))throw new TypeError('S1 rack cells accept Needle or Wisp payloads.');result.payload=value.payload||'needle';}
 return result;
}
export const canMountShipWeapon = (socket,weapon) => !!socket&&!!weapon&&HARDPOINT_SIZES.includes(socket.size)&&HARDPOINT_SIZES.includes(weapon.size)&&weapon.size<=socket.size;
export function subtreeNodes(document, rootId) {
 const ids=new Set([rootId]);let changed=true;
 while(changed){changed=false;for(const n of document.nodes||[])if(ids.has(n.parentId)&&!ids.has(n.id)){ids.add(n.id);changed=true;}}
 return (document.nodes||[]).filter(n=>ids.has(n.id));
}
export function weaponRoot(document, selectedId=null) {
 if(selectedId){const byId=new Map(document.nodes.map(n=>[n.id,n]));let n=byId.get(selectedId),seen=new Set();while(n&&!seen.has(n.id)){if(n.shipWeapon)return n;seen.add(n.id);n=byId.get(n.parentId);}return null;}
 return document?.nodes?.find(n=>n.shipWeapon)||null;
}
export function weaponRig(document, root=weaponRoot(document)) {
 const nodes=root?subtreeNodes(document,root.id):[];
 return {root,yaw:nodes.find(n=>n.tags.includes('armament-yaw')),pitch:nodes.find(n=>n.tags.includes('armament-pitch')),
  muzzles:nodes.filter(n=>n.tags.includes('armament-muzzle')),rotor:nodes.find(n=>n.tags.includes('armament-rotor'))};
}
export function validateShipArmament(document) {
 const errors=[];
 for(const n of document.nodes||[]){try{
  if(n.shipHardpoint){normalizeShipHardpoint(n.shipHardpoint);const fitted=subtreeNodes(document,n.id).filter(child=>child.shipWeapon);if(fitted.length>1)errors.push(`${n.name}: one weapon is allowed per hardpoint.`);if(fitted.some(w=>!canMountShipWeapon(n.shipHardpoint,w.shipWeapon)))errors.push(`${n.name}: fitted weapon exceeds socket size.`);}
  if(n.shipWeapon){normalizeShipWeapon(n.shipWeapon);const rig=weaponRig(document,n),parts=subtreeNodes(document,n.id);
   if(n.type!=='group'||parts.filter(p=>p.tags.includes('armament-yaw')).length!==1||parts.filter(p=>p.tags.includes('armament-pitch')).length!==1||!rig.muzzles.length)errors.push(`${n.name}: weapon needs one yaw group, one pitch group and muzzle groups.`);
   else if(!subtreeNodes(document,rig.yaw.id).some(p=>p.id===rig.pitch.id)||rig.muzzles.some(m=>!subtreeNodes(document,rig.pitch.id).some(p=>p.id===m.id)))errors.push(`${n.name}: pitch must follow yaw, and muzzles must follow pitch.`);
  }
 }catch(e){errors.push(`${n.name}: ${e.message}`);}}
 return errors;
}
const rad=Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function stepWeaponGimbal(config, angles, direction, dt) {
 const length=Math.hypot(...direction)||1, desiredYaw=Math.atan2(-direction[0],-direction[2])/rad,desiredPitch=Math.asin(clamp(direction[1]/length,-1,1))/rad;
 const wanted=[clamp(desiredYaw,-config.yaw,config.yaw),clamp(desiredPitch,-config.pitch,config.pitch)];
 const step=config.tracking*clamp(dt,0,.25);
 return {yaw:angles.yaw+clamp(wanted[0]-angles.yaw,-step,step),pitch:angles.pitch+clamp(wanted[1]-angles.pitch,-step,step),
  reachable:Math.abs(desiredYaw)<=config.yaw&&Math.abs(desiredPitch)<=config.pitch};
}
export function weaponPose(document,angles={yaw:0,pitch:0},phase=0) {
 const rig=weaponRig(document),pose=new Map();
 if(rig.yaw)pose.set(rig.yaw.id,{rotation:{axis:[0,1,0],angle:angles.yaw*rad}});
 if(rig.pitch)pose.set(rig.pitch.id,{rotation:{axis:[1,0,0],angle:angles.pitch*rad}});
 if(rig.rotor)pose.set(rig.rotor.id,{rotation:{axis:[0,0,1],angle:phase}});
 return pose;
}
/** Use the same posed hierarchy as both renderers, retaining nonuniform scale. */
export function posedWeaponMuzzle(document,pose=new Map(),index=0) {
 const rig=weaponRig(document),muzzle=rig.muzzles[index%rig.muzzles.length];
 if(!muzzle)return null;
 const byId=new Map(document.nodes.map(n=>[n.id,n]));let node=muzzle,points=[[0,0,0],[0,0,-1]],seen=new Set();
 while(node&&!seen.has(node.id)){
  seen.add(node.id);const t=applySolWorldPose(node.transform,pose.get(node.id)||{}),q=qFromXYZ(t.rotation);
  points=points.map(p=>qRotate(q,p.map((v,i)=>v*t.scale[i])).map((v,i)=>v+t.position[i]));node=byId.get(node.parentId);
 }
 const direction=points[1].map((v,i)=>v-points[0][i]),length=Math.hypot(...direction)||1;
 return {position:points[0],direction:direction.map(v=>v/length)};
}
export function createWeaponState(config) {return {ammo:config.magazine,heat:0,energy:100,cooldown:0,reload:0,totalShots:0,overheated:false};}
/** Time-based admission preserves authored RPM above the display frame rate;
 * bounded catch-up prevents background-tab bursts. Missiles fire one cell at a time. */
export function stepWeaponFire(config,runtime,dt,trigger) {
 dt=clamp(Number(dt)||0,0,.1);runtime.heat=Math.max(0,runtime.heat-config.cooling*dt);runtime.energy=Math.min(100,runtime.energy+20*dt);
 if(runtime.overheated&&runtime.heat<35)runtime.overheated=false;
 if(runtime.reload>0){runtime.reload=Math.max(0,runtime.reload-dt);if(!runtime.reload)runtime.ammo=config.magazine;return 0;}
 runtime.cooldown-=dt;let shots=0;
 while(trigger&&runtime.cooldown<=0&&shots<8){
  if(runtime.overheated||runtime.energy<config.energyPerShot)break;
  if(runtime.ammo<=0){runtime.reload=config.reloadSeconds;break;}
  if(runtime.heat+config.heatPerShot>100){runtime.overheated=true;break;}
  runtime.ammo--;runtime.heat+=config.heatPerShot;runtime.energy-=config.energyPerShot;runtime.totalShots++;shots++;
  runtime.cooldown+=60/config.rpm;
 }
 if(!trigger||runtime.cooldown<-.1||(!shots&&runtime.cooldown<0))runtime.cooldown=Math.max(0,runtime.cooldown);
 return shots;
}
export function weaponCombatSpec(config,name='Mounted weapon') {
 return {id:'mounted',label:name,kind:['missile','rack'].includes(config.family)?'rocket':'bolt',cooldown:60/config.rpm,
  speed:config.speed,damage:config.damage,range:config.range,life:config.range/config.speed,radius:config.family==='ballistic'?.18:.4,
  color:config.family==='ballistic'?[1,.72,.28]:config.family==='energy'?[.2,.95,1]:[1,.4,.15],
  splash:config.splash,turnRate:config.turnRate,shieldDamage:config.shieldMultiplier,armourPenetration:config.armourPenetration,salvo:1};
}
export function playerShipHardpoints(profile) {
 const w=profile.width||10,h=profile.height||4,l=profile.length||16;
 const wing=profile.hullClass==='light'?1:['heavy','heavy-medium','capital'].includes(profile.hullClass)?3:2;
 return [{id:'port',name:'Port wing',size:wing,position:[-w*.4,-h*.1,-l*.08]},
 {id:'starboard',name:'Starboard wing',size:wing,position:[w*.4,-h*.1,-l*.08]},
 {id:'dorsal',name:'Dorsal heavy mount',size:Math.min(4,wing+1),position:[0,h*.56,l*.28]}];
}
