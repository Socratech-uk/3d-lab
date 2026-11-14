import {check} from './core.mjs';

export const FOOT_ROLES=Object.freeze(['LeftFoot','RightFoot','LeftFrontFoot','RightFrontFoot','LeftBackFoot','RightBackFoot']);
export const EVENT_NAMES=Object.freeze(['left-foot-down','right-foot-down','left-foot-up','right-foot-up','reload-click','equip','unequip','impact','custom']);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const number=(v,lo,hi,label)=>{check(typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi,`${label} must be between ${lo} and ${hi}.`);return v;};
const id=v=>{check(typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v),'Invalid marker identifier.');return v;};
export const defaultGameClip=()=>({version:1,interruptible:true,rootMotion:'in-place',strideLength:null,events:[],contacts:[]});

/** Optional authoring metadata, embedded in the existing action document. */
export function normalizeGameClip(value,duration){
 check(object(value)&&value.version===1,'Unsupported game action settings.');
 check(['in-place','authored'].includes(value.rootMotion??'in-place'),'Choose in-place or authored root motion.');
 check(value.interruptible===undefined||typeof value.interruptible==='boolean','Invalid action interruption setting.');
 check(Array.isArray(value.events??[])&&(value.events?.length??0)<=256,'Keep at most 256 events per action.');
 check(Array.isArray(value.contacts??[])&&(value.contacts?.length??0)<=128,'Keep at most 128 foot contacts per action.');
 const ids=new Set(),unique=v=>{v=id(v);check(!ids.has(v),'Marker identifiers must be unique within an action.');ids.add(v);return v;};
 const events=(value.events??[]).map(e=>{
  check(object(e)&&typeof e.name==='string'&&/^[a-z][a-z0-9_.:-]{0,63}$/.test(e.name),'Event names use lowercase letters, numbers, dots, colons, underscores or hyphens.');
  return {id:unique(e.id),name:e.name,time:number(e.time,0,duration,'Event time')};
 }).sort((a,b)=>a.time-b.time);
 const contacts=(value.contacts??[]).map(c=>{
  check(object(c)&&FOOT_ROLES.includes(c.role),'Choose a recognised foot for the contact.');
  const from=number(c.from,0,duration,'Contact start'),to=number(c.to,0,duration,'Contact end');
  check(to-from>=.01-1e-7,'Foot contacts need at least 0.01 seconds.');
  return {id:unique(c.id),role:c.role,from,to};
 }).sort((a,b)=>a.from-b.from);
 for(const role of FOOT_ROLES){const rows=contacts.filter(c=>c.role===role).sort((a,b)=>a.from-b.from);for(let i=1;i<rows.length;i++)check(rows[i].from>=rows[i-1].to-1e-7,'Foot contacts for the same foot cannot overlap.');}
 const result={version:1,interruptible:value.interruptible!==false,rootMotion:value.rootMotion??'in-place',strideLength:value.strideLength==null?null:number(value.strideLength,.01,100,'Distance per cycle'),events,contacts};
 if(value.transfer){const t=value.transfer;check(object(t)&&[t.sourceTitle,t.sourceAction].every(s=>typeof s==='string'&&s.length<=160&&!/[\u0000-\u001f\u007f]/.test(s)),'Invalid motion transfer source.');check([t.sourceRig,t.targetRig].every(s=>typeof s==='string'&&/^[0-9a-f]{16}$/.test(s)),'Invalid motion transfer rig signature.');result.transfer={sourceTitle:t.sourceTitle,sourceAction:t.sourceAction,sourceRig:t.sourceRig,targetRig:t.targetRig};}
 return result;
}
export function trimGameClip(game,duration){
 if(!game)return undefined;return normalizeGameClip({...game,events:game.events.filter(e=>e.time<=duration),contacts:game.contacts.filter(c=>c.from<duration-.01).map(c=>({...c,to:Math.min(c.to,duration)}))},duration);
}
export function reverseGameClip(game,duration){
 if(!game)return undefined;const swap=name=>name.endsWith('-foot-down')?name.replace(/-down$/,'-up'):name.endsWith('-foot-up')?name.replace(/-up$/,'-down'):name;
 return normalizeGameClip({...game,events:game.events.map(e=>({...e,time:duration-e.time,name:swap(e.name)})),contacts:game.contacts.map(c=>({...c,from:duration-c.to,to:duration-c.from}))},duration);
}

/** The loop bake starts at from+fade and wraps the initial blend region to its
 * tail. Map markers with the same time transform; never silently drop contacts. */
export function bakeGameClip(game,{from,to,fade=0,loop=true,sourceDuration=to-from}){
 if(!game)return undefined;const duration=to-from-fade,origin=from+fade,wrap=t=>((t-origin)%duration+duration)%duration;
 const events=game.events.filter(e=>e.time>=from&&e.time<=to&&(loop?e.time<to-1e-7:true)).map(e=>({...e,time:loop?wrap(e.time):e.time-from}));
 const contacts=[];
 for(const c of game.contacts){const a=Math.max(from,c.from),b=Math.min(to,c.to);if(b-a<.01)continue;
  // Split at the new loop boundary, preserving both pieces of a planted foot.
  const segments=loop?[[Math.max(a,origin),b,0],[a,Math.min(b,origin),duration]]:[[a,b,0]];
  for(const [left,right,offset]of segments)if(right-left>=.01)contacts.push({...c,id:c.id.slice(0,100)+'-b'+contacts.length,from:Math.max(0,left-origin+offset+(loop?0:fade)),to:Math.min(duration,right-origin+offset+(loop?0:fade))});
 }
 // Blended loop head/tail can cover the same contact interval; union each foot.
 const merged=[];for(const role of FOOT_ROLES)for(const c of contacts.filter(v=>v.role===role).sort((a,b)=>a.from-b.from)){const prev=merged.at(-1);if(prev?.role===role&&c.from<=prev.to+1e-7)prev.to=Math.max(prev.to,c.to);else merged.push(c);}
 return normalizeGameClip({...game,strideLength:game.strideLength?game.strideLength*(to-from)/sourceDuration:null,rootMotion:'in-place',events,contacts:merged},duration);
}

/** Half-open crossings: an endpoint is delivered once, including loop wraps. */
export function crossedGameEvents(game,previous,current,duration,{loop=false,includeStart=false}={}){
 if(!game||current<previous||!Number.isFinite(current)||!Number.isFinite(previous)||duration<=0)return [];
 const events=[];const start=loop?Math.floor(previous/duration):0,end=loop?Math.floor(current/duration):0;
 check(end-start<=64,'Too many event cycles in one update.');
 for(let cycle=start;cycle<=end;cycle++)for(const e of game.events){if(loop&&e.time>=duration-1e-7)continue;const time=e.time+cycle*duration;if((time>previous+1e-7||includeStart&&Math.abs(time-previous)<1e-7)&&time<=current+1e-7)events.push({...e,cycle});}
 return events;
}
