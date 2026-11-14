import { qFromXYZ, qToXYZ, qSlerp } from '../characters/humanoid-motion.js?v=1.0.0';
import {
  SOL_MODEL_PUBLISH_PREFIX,
  deepClone,
  normaliseSolModelDocument,
} from './sol-model-document.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mix = (a, b, t) => a + (b - a) * t;
const mixValue = (a, b, t) => Array.isArray(a)
  ? a.map((value, index) => mix(Number(value) || 0, Number(b?.[index]) || 0, t))
  : mix(Number(a) || 0, Number(b) || 0, t);

function sampleKeyframes(keyframes, time, interpolation = 'linear', quaternion = false) {
  if (!Array.isArray(keyframes) || !keyframes.length) return null;
  if (keyframes.length === 1 || time <= keyframes[0].time) return deepClone(keyframes[0].value);
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return deepClone(last.value);
  let nextIndex = keyframes.findIndex(keyframe => Number(keyframe.time) >= time);
  if (nextIndex < 1) nextIndex = 1;
  const previous = keyframes[nextIndex - 1];
  const next = keyframes[nextIndex];
  if (interpolation === 'step') return deepClone(previous.value);
  const span = Math.max(.000001, Number(next.time) - Number(previous.time));
  let alpha = clamp((time - Number(previous.time)) / span, 0, 1);
  if (interpolation === 'cubic') alpha = alpha * alpha * (3 - 2 * alpha);
  if(quaternion)return qToXYZ(qSlerp(qFromXYZ(previous.value),qFromXYZ(next.value),alpha));
  return mixValue(previous.value, next.value, alpha);
}

export function evaluateSolAnimation(document, clipId, rawTime = 0) {
  const clip = (document?.animations || []).find(entry => entry.id === clipId);
  if (!clip) return new Map();
  const duration = Math.max(.01, Number(clip.duration) || 1);
  const time = clip.loop ? ((Number(rawTime) || 0) % duration + duration) % duration : clamp(rawTime, 0, duration);
  const pose = new Map();
  for (const track of clip.tracks || []) {
    if (!track?.nodeId || !['position', 'rotation', 'scale'].includes(track.property)) continue;
    const value = sampleKeyframes(track.keyframes, time, track.interpolation, Boolean(document.meta?.parameters?.humanoidRig&&track.nodeId.startsWith('rig-')&&track.property==='rotation'));
    if (value == null) continue;
    const nodePose = pose.get(track.nodeId) || {};
    nodePose[track.property] = value;
    pose.set(track.nodeId, nodePose);
  }
  return pose;
}

export function resolveSolAction(document, context = {}) {
  const speed = Math.max(0, Number(context.speed) || 0);
  const surfaceMode = String(context.surfaceMode || 'ground');
  const weapon = String(context.weapon || 'any');
  const requested = String(context.action || (surfaceMode === 'zero-g' ? (speed > .05 ? 'zeroGMove' : 'zeroGIdle') : (speed > 3.7 ? 'run' : speed > .08 ? 'walk' : 'idle')));
  const candidates = (document?.actionMap || []).filter(mapping => {
    if (mapping.action !== requested) return false;
    const conditions = mapping.conditions || {};
    if (!['any', surfaceMode].includes(conditions.surfaceMode || 'any')) return false;
    if (speed < Number(conditions.minSpeed || 0) || speed > Number(conditions.maxSpeed ?? Infinity)) return false;
    return !conditions.weapon || conditions.weapon === 'any' || conditions.weapon === weapon;
  });
  return candidates.sort((a, b) => {
    const aSpecific = (a.conditions?.surfaceMode !== 'any' ? 2 : 0) + (a.conditions?.weapon !== 'any' ? 1 : 0);
    const bSpecific = (b.conditions?.surfaceMode !== 'any' ? 2 : 0) + (b.conditions?.weapon !== 'any' ? 1 : 0);
    return bSpecific - aSpecific;
  })[0] || null;
}

export function simulateSolSurface(surface, velocity = [0, 0, 0], input = [0, 0, 0], dt = 1 / 60) {
  const mode = surface?.locomotion || 'ground';
  const traction = clamp(surface?.traction ?? .7, 0, 1);
  const drag = Math.max(0, Number(surface?.linearDrag) || 0);
  const friction = Math.max(0, Number(surface?.dynamicFriction) || 0);
  const step = Math.max(0, Number(dt) || 0);
  const response = mode === 'zero-g' ? 2.8 : 9 * traction;
  const next = velocity.slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    next[index] += (Number(input[index]) || 0) * response * step;
    const damping = Math.exp(-(drag + (mode === 'zero-g' ? 0 : friction * .7)) * step);
    next[index] *= damping;
  }
  if (mode !== 'zero-g') next[1] = 0;
  return next;
}

export class SolAnimationPlayer {
  constructor(document) {
    this.setDocument(document);
    this.playing = false;
    this.time = 0;
    this.clipId = this.document.animations[0]?.id || null;
  }

  setDocument(document) {
    this.document = normaliseSolModelDocument(document);
    if (this.clipId && !this.document.animations.some(clip => clip.id === this.clipId)) this.clipId = this.document.animations[0]?.id || null;
  }

  update(dt) {
    if (this.playing) this.time += Math.max(0, Number(dt) || 0);
    return this.pose();
  }

  seek(time) {
    this.time = Math.max(0, Number(time) || 0);
    return this.pose();
  }

  pose() {
    return evaluateSolAnimation(this.document, this.clipId, this.time);
  }
}

export function publishSolModel(slot, document, storage = globalThis.localStorage) {
  if (!storage) return false;
  storage.setItem(`${SOL_MODEL_PUBLISH_PREFIX}${String(slot || 'preview')}`, JSON.stringify(document));
  return true;
}

export function loadPublishedSolModel(slot, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(`${SOL_MODEL_PUBLISH_PREFIX}${String(slot || 'preview')}`);
    return raw ? normaliseSolModelDocument(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearPublishedSolModel(slot, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(`${SOL_MODEL_PUBLISH_PREFIX}${String(slot || 'preview')}`);
    return true;
  } catch {
    return false;
  }
}

/** One pose authority for retained Three and the procedural/offline fallback.
 * Rig clips are ordinary editable SOL tracks. Runtime blends them, never
 * changes/restores the authored node transforms or regenerates body parts.
 */
export function evaluateSolModelPose(document, context = {}) {
  const {cycle=0,speed=0,moving=false,action=null,surfaceMode='ground',weapon='any'}=context;
  const mapping=resolveSolAction(document,{action,speed:moving?speed:0,surfaceMode,weapon});
  const rig=document.meta?.parameters?.humanoidRig;
  if(!rig || rig.clipSet!=='articulated-v1' || (mapping && !mapping.id.startsWith('rig-'))) {
    return evaluateSolAnimation(document,mapping?.clipId||document.animations?.[0]?.id,(context.animationTime??cycle)*Number(mapping?.speedScale||1));
  }
  const blend=(a,b,weight)=>{
    const out=new Map(),ids=new Set([...a.keys(),...b.keys()]);
    for(const id of ids){
      const node=document.nodes.find(n=>n.id===id),A=a.get(id)||node?.transform||{},B=b.get(id)||node?.transform||{},next={};
      for(const property of ['position','rotation','scale']){
        const fallback=property==='scale'?[1,1,1]:[0,0,0],x=A[property]||fallback,y=B[property]||fallback;
        next[property]=property==='rotation'?qToXYZ(qSlerp(qFromXYZ(x),qFromXYZ(y),weight)):x.map((v,i)=>v+(y[i]-v)*weight);
      }
      out.set(id,next);
    }
    return out;
  };
  const phase=(Number(cycle)||0)/(Math.PI*2);
  const clip=id=>{const item=document.animations.find(c=>c.id===id);return evaluateSolAnimation(document,id,phase*(item?.duration||1));};
  const airborne=context.grounded===false||surfaceMode==='zero-g';
  const weight=airborne?0:clamp(context.motionWeight??(moving?1:0),0,1);
  const armed=clamp(context.aimWeight??(context.aiming?1:0),0,1);
  const [lateral,forward]=context.direction||[0,1];
  const motion=forward<-.5?'back':Math.abs(lateral)>.5?(lateral<0?'left':'right'):speed>2.5?'run':'walk';
  const neutral=airborne?'zero-g':'idle',ready=airborne?'zero-g-ready':'ready';
  const rest=blend(clip('clip-'+neutral),clip('clip-'+ready),armed);
  if(weight<1e-7)return rest;
  return blend(rest,blend(clip('clip-'+motion),clip('clip-'+motion+'-ready'),armed),weight);
}
