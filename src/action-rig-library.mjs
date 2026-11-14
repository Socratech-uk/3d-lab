import {check,text} from './core.mjs';
import {ACTION_LIMITS,createClip,normalizeActionDocument,uid} from './action-document.mjs';
import {transferMap,transferGameAction} from './action-game-analysis.mjs';
import {normalizeGameClip} from './action-game-data.mjs';

export const RIG_RECIPE_FORMAT='capp.rig-recipe';
export const RIG_SHELF_LIMITS=Object.freeze({recipes:32,bytes:128*1024**2,recipeBytes:24*1024**2});
const finite=(v,lo,hi,label)=>{check(typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi,`${label} must be between ${lo} and ${hi}.`);return v;};
const byteLength=value=>new TextEncoder().encode(value).length;
const validId=id=>{check(typeof id==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id),'Invalid rig recipe identifier.');return id;};
export function normalizeRigBounds(value){
 check(value&&['min','max'].every(k=>Array.isArray(value[k])&&value[k].length===3),'Rig recipes need model bounds.');
 const bounds=Object.fromEntries(['min','max'].map(k=>[k,value[k].map(n=>finite(n,-1e6,1e6,'Model bounds'))]));
 check(bounds.max.every((v,i)=>v>=bounds.min[i])&&bounds.max[1]-bounds.min[1]>1e-6,'The model must have a measurable height.');return bounds;
}
export function jointBounds(joints){check(joints.length,'Add a skeleton before saving a rig recipe.');return normalizeRigBounds({min:[0,1,2].map(i=>Math.min(...joints.map(j=>j.position[i]))),max:[0,1,2].map(i=>Math.max(...joints.map(j=>j.position[i])))});}
export function normalizeRigRecipe(value){
 check(value&&value.format===RIG_RECIPE_FORMAT&&value.version===1,'Choose an Action Lab rig recipe.');
 const actionDocument=normalizeActionDocument(value.actionDocument);check(actionDocument.joints.length,'A reusable rig needs at least one joint.');
 // Mesh identities, skin weights and equipment placements belong to a character,
 // never to the portable skeleton/action shelf.
 actionDocument.bindings={};delete actionDocument.equipment;delete actionDocument.movement;
 const result={format:RIG_RECIPE_FORMAT,version:1,id:validId(value.id),name:text(value.name,120,true),bounds:normalizeRigBounds(value.bounds),actionDocument};
 check(byteLength(JSON.stringify(result))<=RIG_SHELF_LIMITS.recipeBytes,'Rig recipes must be smaller than 24 MiB.');return result;
}
export function createRigRecipe(document,{name=document.title,bounds=jointBounds(document.joints)}={}){
 return normalizeRigRecipe({format:RIG_RECIPE_FORMAT,version:1,id:uid('rig'),name,bounds,actionDocument:document});
}
export function parseRigRecipe(value){
 check(typeof value==='string'&&byteLength(value)<=RIG_SHELF_LIMITS.recipeBytes,'Rig recipes must be smaller than 24 MiB.');
 const input=JSON.parse(value);if(input?.format===RIG_RECIPE_FORMAT)return normalizeRigRecipe(input);
 const document=normalizeActionDocument(input?.format==='capp.movement-pack'?input.actionDocument:input);
 return createRigRecipe(document,{name:document.title});
}

/** Full rest-frame equality up to translation and positive uniform scale. IDs
 * intentionally matter: a name match alone cannot establish bone compatibility. */
export function sameRigTransform(source,target){
 if(!source.joints.length||source.joints.length!==target.joints.length)return null;
 const a=new Map(source.joints.map(j=>[j.id,j])),b=new Map(target.joints.map(j=>[j.id,j]));
 const pivot=source.joints.find(j=>j.parent===null),p=b.get(pivot?.id);if(!p)return null;
 let scale=1,best=0;
 for(const j of source.joints){const t=b.get(j.id);if(!t)return null;const d=Math.hypot(...j.position.map((v,i)=>v-pivot.position[i]));if(d>best){best=d;scale=Math.hypot(...t.position.map((v,i)=>v-p.position[i]))/d;}}
 if(!Number.isFinite(scale)||scale<1e-6||scale>1e6)return null;
 const epsilon=Math.max(1e-7,best*scale*1e-6),close=(x,y,tol=1e-6)=>Math.abs(x-y)<=tol;
 for(const [id,j]of a){const t=b.get(id);if(j.parent!==t.parent||j.type!==t.type||j.locked!==t.locked)return null;
  if(!j.position.every((v,i)=>close((v-pivot.position[i])*scale,t.position[i]-p.position[i],epsilon)))return null;
  if(Math.abs(j.rotation.reduce((sum,v,i)=>sum+v*t.rotation[i],0))<1-1e-7)return null;
  if(!j.axis.every((v,i)=>close(v,t.axis[i])))return null;
  if(!['min','max'].every(k=>close(j[k]*(j.type==='slider'?scale:1),t[k],Math.max(1e-6,Math.abs(t[k])*1e-6))))return null;
 }
 return {scale,translation:p.position.map((v,i)=>v-pivot.position[i]*scale)};
}
export function rigCompatibility(recipeValue,targetValue){
 const source=normalizeRigRecipe(recipeValue).actionDocument,target=normalizeActionDocument(targetValue),same=sameRigTransform(source,target);
 if(same)return {mode:'same-rig',compatible:true,scale:same.scale,message:`Shared skeleton: actions can be copied directly${Math.abs(same.scale-1)>.00001?' at '+same.scale.toFixed(3)+'× rig scale':''}. Meshes and weights stay in place.`};
 try{const mapping=transferMap(source,target);return {mode:'retarget',compatible:true,roles:mapping.rows.length,message:`Different skeletons: ${mapping.rows.length} reviewed body roles can transfer the action. Preview bends, contacts and stride afterwards.`};}
 catch(error){return {mode:'unavailable',compatible:false,message:target.joints.length?'Review body maps on the saved source and current character before transferring between different skeletons. '+error.message:'Fit this saved skeleton to the character first, then bind and inspect it.'};}
}

/** Pure proposal. Caller owns undo and removal of the old mesh skin attributes. */
export function fitRigRecipe(recipeValue,targetValue,targetBounds,{replaceRig=false}={}){
 const recipe=normalizeRigRecipe(recipeValue),target=normalizeActionDocument(targetValue),bounds=normalizeRigBounds(targetBounds);
 check(!target.joints.length||replaceRig,'This character already has a skeleton. Explicitly allow replacement before fitting another rig.');
 const origin=recipe.bounds,scale=(bounds.max[1]-bounds.min[1])/(origin.max[1]-origin.min[1]);
 finite(scale,1e-4,1e4,'Rig fit scale');
 const center=b=>[(b.min[0]+b.max[0])/2,b.min[1],(b.min[2]+b.max[2])/2],a=center(origin),b=center(bounds);
 target.joints=recipe.actionDocument.joints.map(j=>({...structuredClone(j),position:j.position.map((v,i)=>(v-a[i])*scale+b[i]),...(j.type==='slider'?{min:j.min*scale,max:j.max*scale}:{})}));
 target.bindings=Object.fromEntries(Object.keys(target.bindings).map(id=>[id,{mode:'unbound'}]));
 target.clips=[createClip('New action')];delete target.bodyMap;delete target.movement;delete target.equipment;
 if(recipe.actionDocument.bodyMap){target.bodyMap=structuredClone(recipe.actionDocument.bodyMap);delete target.bodyMap.signature;}
 return {document:normalizeActionDocument(target),scale,message:'Skeleton fitted by model height and grounded to its bounds. Check joints against this body, review the body map, then calculate fresh weights. Proportions and clothing still need inspection.'};
}

/** Copy/retarget into a new clip only. Positive speed changes key times and all
 * game markers together; travel scales root X/Z displacement, not limb poses. */
export function reuseRigAction(recipeValue,targetValue,clipId,{speed=1,travelScale=1,name}={}){
 finite(speed,.1,4,'Playback speed');finite(travelScale,0,4,'Root travel scale');
 const source=normalizeRigRecipe(recipeValue).actionDocument,target=normalizeActionDocument(targetValue),sourceClip=source.clips.find(c=>c.id===clipId);
 check(sourceClip&&Object.values(sourceClip.tracks).some(keys=>keys.length),'Choose a saved action with pose keys.');
 check(target.clips.length<ACTION_LIMITS.clips,'This character already has 32 actions. Remove an unused action before adding a variation.');
 const transform=sameRigTransform(source,target);let clip,mode;
 if(transform){clip=structuredClone(sourceClip);mode='same-rig';for(const keys of Object.values(clip.tracks))for(const key of keys)key.position=key.position.map(v=>v*transform.scale);}
 else{clip=transferGameAction(source,target,clipId).clip;mode='retarget';}
 clip.id=uid('clip');clip.name=text(name||sourceClip.name+' · reused',120,true);clip.duration=sourceClip.duration/speed;
 check(clip.duration>=.05&&clip.duration<=ACTION_LIMITS.seconds,'This speed would make the action shorter than 0.05 s or longer than 120 s.');
 const roots=new Set(target.joints.filter(j=>j.parent===null).map(j=>j.id));
 for(const [id,keys]of Object.entries(clip.tracks)){const start=keys[0]?.position;
  for(const key of keys){key.time/=speed;if(roots.has(id)&&start)key.position=key.position.map((v,i)=>i===1?v:start[i]+(v-start[i])*travelScale);}
 }
 if(clip.game){const game=structuredClone(clip.game);game.events=game.events.map(e=>({...e,id:uid('event'),time:e.time/speed}));game.contacts=game.contacts.map(c=>({...c,id:uid('contact'),from:c.from/speed,to:c.to/speed}));
  if(game.strideLength!==null)game.strideLength=transform&&Math.abs(transform.scale-1)<1e-6&&travelScale>0?game.strideLength*travelScale:null;
  check(game.strideLength==null||game.strideLength>=.01&&game.strideLength<=100,'The scaled stride is outside 0.01–100 m. Recalibrate the source stride or choose another travel scale.');
  check(game.contacts.every(c=>c.to-c.from>=.01-1e-7),'This speed makes a foot contact shorter than 0.01 s. Choose a lower speed or edit source contacts.');
  clip.game=normalizeGameClip(game,clip.duration);
 }
 const validated=normalizeActionDocument({...target,clips:[...target.clips,clip]}).clips.at(-1);
 return {clip:validated,mode,scale:transform?.scale??null,message:mode==='same-rig'?'Action copied onto the shared skeleton. Preview the variation, then save the character draft.':'Action transferred through reviewed body roles. Preview contacts and recalibrate stride before saving.'};
}

const requestResult=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Rig shelf request failed.'));});
const transactionDone=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Rig shelf transaction was interrupted.'));tx.onerror=()=>{};});
export class RigRecipeStore {
 constructor({indexedDB=globalThis.indexedDB,name='capp.3d-lab.rig-recipes.v1'}={}){this.indexedDB=indexedDB;this.name=name;this.database=null;}
 async open(){
  if(this.database)return this.database;check(this.indexedDB,'Local rig storage is unavailable in this browser. Export a rig recipe to keep a copy.');
  this.database=new Promise((resolve,reject)=>{let blocked=false;const request=this.indexedDB.open(this.name,1);request.onupgradeneeded=()=>request.result.createObjectStore('recipes',{keyPath:'id'});request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>{db.close();this.database=null;};resolve(db);};request.onerror=()=>reject(request.error||new Error('Could not open the local rig shelf.'));request.onblocked=()=>{blocked=true;reject(new Error('Another tab is blocking the rig shelf. Close that tab and try again.'));};});
  try{return await this.database;}catch(error){this.database=null;throw error;}
 }
 async list(){const db=await this.open(),tx=db.transaction('recipes','readonly'),done=transactionDone(tx);done.catch(()=>{});const rows=await requestResult(tx.objectStore('recipes').getAll());await done;return rows.map(({json,...row})=>row).sort((a,b)=>b.updatedAt-a.updatedAt);}
 async get(id){validId(id);const db=await this.open(),tx=db.transaction('recipes','readonly'),done=transactionDone(tx);done.catch(()=>{});const row=await requestResult(tx.objectStore('recipes').get(id));await done;check(row,'That saved rig no longer exists. Refresh the shelf.');return parseRigRecipe(row.json);}
 async save(value){
  const recipe=normalizeRigRecipe(value),json=JSON.stringify(recipe),bytes=byteLength(json),db=await this.open(),tx=db.transaction('recipes','readwrite'),done=transactionDone(tx);done.catch(()=>{});const store=tx.objectStore('recipes');
  try{const rows=await requestResult(store.getAll()),others=rows.filter(r=>r.id!==recipe.id);check(others.length<RIG_SHELF_LIMITS.recipes,'The shelf holds up to 32 rigs. Export and remove an older recipe first.');check(others.reduce((sum,r)=>sum+r.bytes,0)+bytes<=RIG_SHELF_LIMITS.bytes,'The rig shelf has reached 128 MiB. Export and remove an older recipe first.');
   store.put({id:recipe.id,name:recipe.name,joints:recipe.actionDocument.joints.length,actions:recipe.actionDocument.clips.filter(c=>Object.values(c.tracks).some(k=>k.length)).length,bytes,updatedAt:Date.now(),json});await done;return recipe;
  }catch(error){try{tx.abort();}catch{}throw new Error('Could not save the rig recipe: '+error.message);}
 }
 async remove(id){const db=await this.open(),tx=db.transaction('recipes','readwrite'),done=transactionDone(tx);tx.objectStore('recipes').delete(validId(id));await done;}
 async close(){if(this.database)(await this.database).close();this.database=null;}
}
