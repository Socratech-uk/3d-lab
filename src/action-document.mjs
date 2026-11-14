import {normalizeEquipment} from './action-equipment.mjs';
import {normalizeMovement} from './action-movement.mjs';
import {normalizeBodyMap} from './action-anatomy.mjs';
import {normalizeGameClip} from './action-game-data.mjs';
import { check, text } from './core.mjs';
export const ACTION_FORMAT = 'capp.action-lab';
export const ACTION_LIMITS = Object.freeze({ joints:128, clips:32, keys:180000, bytes:24*1024**2, seconds:120, meshes:512 });
export const uid = prefix => prefix+'-'+crypto.randomUUID();
const number = (v,lo=-1e6,hi=1e6) => { check(typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi,'Action data contains an invalid or out-of-range number.');return v; };
const vector = (v,n=3) => { check(Array.isArray(v)&&v.length===n,'Action data needs a finite vector.');return v.map(x=>number(x)); };
const identifier = value => { check(typeof value==='string'&&!['__proto__','constructor','prototype'].includes(value)&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(value),'Invalid action identifier.');return value; };
// Re-normalizing an already-unit quaternion can change its last bits on every
// clone/save. Preserve numerical unit rotations exactly, including action keys.
const quaternion = v => { v=vector(v,4);const length=Math.hypot(...v);check(length>1e-8,'A rotation cannot be an empty quaternion.');return Math.abs(length-1)<=1e-12?v:v.map(x=>x/length); };
const promptText = value => {check(typeof value==='string'&&value.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),'Invalid action prompt.');return value.replace(/\r\n?/g,'\n').trim();};
export function createJoint(position=[0,0,0],parent=null,name='Joint',type='ball') { return {id:uid('joint'),name,parent,position:[...position],rotation:[0,0,0,1],type,axis:[0,1,0],min:type==='slider'?-1:-180,max:type==='slider'?1:180,locked:false}; }
export function createClip(name='Action',duration=2) { return {id:uid('clip'),name,duration,fps:30,loop:false,tracks:{},provenance:null}; }
export function createActionDocument(title='Untitled action') { return {format:ACTION_FORMAT,version:1,title,joints:[],bindings:{},clips:[createClip()],source:null}; }
export function normalizeActionDocument(input) {
  check(input&&input.format===ACTION_FORMAT&&input.version===1,'Choose a supported Action Lab recipe.');
  check(Array.isArray(input.joints)&&input.joints.length<=ACTION_LIMITS.joints,'Use at most 128 joints.');
  const ids=new Set();
  const joints=input.joints.map(j=>{
    const id=identifier(j.id);check(!ids.has(id),'Joint identifiers must be unique.');ids.add(id);
    check(['ball','hinge','slider','fixed'].includes(j.type),'Unknown joint type.');
    let axis=vector(j.axis||[0,1,0]),length=Math.hypot(...axis);check(length>1e-8,'A joint axis must have a direction.');axis=axis.map(v=>v/length);
    const min=number(j.min??-180,-10000,10000),max=number(j.max??180,-10000,10000);check(min<=max,'The joint minimum cannot exceed its maximum.');
    return {id,name:text(j.name||'Joint',120,true),parent:j.parent==null?null:identifier(j.parent),position:vector(j.position),rotation:quaternion(j.rotation||[0,0,0,1]),type:j.type,axis,min,max,locked:j.locked===true};
  });
  const byId=new Map(joints.map(j=>[j.id,j]));
  for(const j of joints){check(j.parent==null||ids.has(j.parent),'A parent joint is missing.');let parent=j,depth=0;const visited=new Set();while(parent){check(!visited.has(parent.id)&&++depth<=64,'Joint chains cannot contain cycles or exceed 64 levels.');visited.add(parent.id);parent=byId.get(parent.parent);}}
  const bindings={};check(input.bindings&&typeof input.bindings==='object'&&!Array.isArray(input.bindings),'Invalid mesh bindings.');check(Object.keys(input.bindings).length<=ACTION_LIMITS.meshes,'Too many mesh bindings.');
  for(const [mesh,b] of Object.entries(input.bindings)){identifier(mesh);check(b&&['skin','rigid','unbound'].includes(b.mode),'Invalid mesh binding.');if(b.mode==='rigid')check(ids.has(b.joint),'The rigid binding joint is missing.');bindings[mesh]={mode:b.mode,...(b.mode==='rigid'?{joint:identifier(b.joint)}:{})};}
  check(Array.isArray(input.clips)&&input.clips.length>0&&input.clips.length<=ACTION_LIMITS.clips,'Keep 1–32 animation clips.');
  let count=0;const clipIds=new Set();
  const clips=input.clips.map(c=>{
    const id=identifier(c.id);check(!clipIds.has(id),'Clip identifiers must be unique.');clipIds.add(id);
    const duration=number(c.duration,.05,ACTION_LIMITS.seconds),fps=number(c.fps||30,1,60);check(Number.isInteger(fps),'Use a whole-number frame rate.');
    check(c.tracks&&typeof c.tracks==='object'&&!Array.isArray(c.tracks),'Invalid animation tracks.');const tracks={};
    for(const [joint,keys] of Object.entries(c.tracks)){
      check(ids.has(joint)&&Array.isArray(keys),'Animation track refers to a missing joint.');count+=keys.length;check(count<=ACTION_LIMITS.keys,'This scene exceeds the animation key budget.');
      let last=-1;tracks[joint]=keys.map(k=>{const time=number(k.time,0,duration+1e-6);check(time>last+1e-7,'Animation key times must be distinct and ordered.');last=time;return {time:Math.min(duration,time),position:vector(k.position||[0,0,0]),rotation:quaternion(k.rotation||[0,0,0,1]),interpolation:k.interpolation==='STEP'?'STEP':'LINEAR'};});
    }
    const provenance=c.provenance?{model:text(String(c.provenance.model||''),120),prompt:promptText(String(c.provenance.prompt||'')),seed:number(c.provenance.seed??0,0,2147483647),...(c.provenance.guidanceScale===undefined?{}:{guidanceScale:number(c.provenance.guidanceScale,1,7)})}:null;
    return {id,name:text(c.name||'Action',120,true),duration,fps,loop:c.loop===true,tracks,provenance,...(c.game?{game:normalizeGameClip(c.game,duration)}:{})};
  });
  const source=input.source?{id:text(input.source.id||'',120),sha256:text(input.source.sha256||'',64)}:null;
  return {format:ACTION_FORMAT,version:1,title:text(input.title||'Untitled action',160,true),joints,bindings,clips,source,...(input.bodyMap?{bodyMap:normalizeBodyMap(input.bodyMap,joints)}:{}),...(input.movement?{movement:normalizeMovement(input.movement,clips,joints)}:{}),...(input.equipment?{equipment:normalizeEquipment(input.equipment,joints,clips)}:{})};
}
export const cloneActionDocument = doc => normalizeActionDocument(doc);
export function parseActionDocument(value) { check(typeof value==='string'&&new TextEncoder().encode(value).length<=ACTION_LIMITS.bytes,'Action recipes must be smaller than 24 MiB.');return normalizeActionDocument(JSON.parse(value)); }
export function stringifyActionDocument(doc) { const value=JSON.stringify(normalizeActionDocument(doc),null,2);check(new TextEncoder().encode(value).length<=ACTION_LIMITS.bytes,'Action recipe exceeds 24 MiB.');return value; }
export function setPoseKey(clip,joint,time,pose) {
  time=Math.max(0,Math.min(clip.duration,Math.round(time*clip.fps)/clip.fps));
  const keys=clip.tracks[joint]||[];clip.tracks[joint]=[...keys.filter(k=>Math.abs(k.time-time)>1e-6),{time,position:[...pose.position],rotation:[...pose.rotation],interpolation:pose.interpolation==='STEP'?'STEP':'LINEAR'}].sort((a,b)=>a.time-b.time);
}
