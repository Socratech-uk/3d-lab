import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check} from './core.mjs';
import {autoBind} from './action-geometry.mjs';
import {bodyMapReport,bodySignature,suggestBodySetup} from './action-anatomy.mjs';
import {fitRigRecipe,reuseRigAction} from './action-rig-library.mjs';

/** The graph orchestrates existing authoring operations. It never owns model
 * downloads, bypasses provider permissions, or substitutes invented inference. */
export function createActionFlowAdapters(lab,services={}){
 const stopped=signal=>check(!signal?.aborted,'Workflow cancelled. Completed actions and saved drafts are retained.');
 const character=extra=>({kind:'character',sceneToken:lab.sceneToken,assetId:lab.record?.asset?.id||null,title:lab.document?.title||'',jointCount:lab.document?.joints.length||0,clipIds:lab.document?.clips.map(c=>c.id)||[],...extra});
 const ready=input=>{check(input===undefined||input?.kind==='character'&&typeof input.sceneToken==='string'&&input.sceneToken===lab.sceneToken,'The character changed while the workflow was paused. Cancel and start a new run for this character.');check(lab.active&&lab.base&&lab.document,'Open a character in Action Lab first.');check(!lab.hasPending,'Finish the current editing gesture first.');};
 const modelOptions=(config,policy)=>{check(policy.acceptedModels?.includes(config.model),'Accept the selected model terms for this run.');return {...config,device:config.device||'auto',seed:config.seed??0,licenseAccepted:true};};
 async function engineJob(ctx,fn){
  stopped(ctx.signal);check(!lab.busy&&!lab.engine.busy,'Another Action Lab operation is running.');lab.stop();lab.busy=true;lab.render();lab.configureTool();
  const cancel=()=>void lab.engine.cancel().catch(()=>{});ctx.signal?.addEventListener('abort',cancel,{once:true});
  try{const output=await fn();stopped(ctx.signal);ready(ctx.input);return output;}finally{ctx.signal?.removeEventListener('abort',cancel);lab.busy=false;lab.render();lab.configureTool();}
 }
 async function load(ctx){const options=modelOptions(ctx.config,ctx.policy);if(!lab.engine.isLoaded(options))await lab.engine.prepare(options);stopped(ctx.signal);ready(ctx.input);return options;}
 function acceptedMap(config){
  let map=lab.document.bodyMap;
  const kind=config.kind&&config.kind!=='auto'?config.kind:null,facing=config.facing&&config.facing!=='auto'?config.facing:null;
  if(!map||kind&&map.kind!==kind||facing&&map.facing!==facing){
   const suggestion=suggestBodySetup(lab.document.joints,{kind,facing});
   // The editor's proposal can contain manual corrections made during a pause.
   const draft=lab.bodyMapper.map;
   map=draft&&(!kind||draft.kind===kind)&&(!facing||draft.facing===facing)?draft:suggestion.map;
  }
  const report=bodyMapReport(lab.document.joints,map,{requireReview:false});
  check(!report.issues.length,'Body map needs attention: '+report.issues.join(' ')+' Hide the workflow, correct Body map, then retry.');
  return {...map,signature:bodySignature(lab.document.joints,map)};
 }
 return {
  current:async({signal})=>{stopped(signal);ready();check(!lab.skeletonCandidate,'Apply or discard the pending skeleton first.');return character();},
  reference:async ctx=>{stopped(ctx.signal);check(services.reference,'Reference input is unavailable.');return services.reference(ctx);},
  model:async ctx=>{stopped(ctx.signal);modelOptions(ctx.config,ctx.policy);check(services.generateModel,'Image-to-3D is unavailable in this workspace.');return services.generateModel(ctx);},
  predict:async ctx=>{ready(ctx.input);check(!lab.skeletonCandidate,'Apply or discard the existing skeleton candidate first.');const result=await engineJob(ctx,async()=>{const options=await load(ctx);try{return await lab.engine.generate(options,lab.base,lab.document);}finally{if(ctx.config.unloadAfter&&lab.engine.client)try{await lab.engine.unload();}catch(e){ctx.progress?.('Skeleton retained; model unload failed: '+e.message);}}});stopped(ctx.signal);lab.beginSkeletonCandidate(result);return character({candidate:true});},
  accept:async ctx=>{
   ready(ctx.input);stopped(ctx.signal);const map=acceptedMap(ctx.config);
   if(lab.skeletonCandidate){lab.document.bodyMap=map;lab.applySkeletonCandidate(false);}else lab.change(()=>{lab.document.bodyMap=map;});
   lab.bodyMapper.reset();return character({candidate:false,bodyMapAccepted:true});
  },
  bind:async ctx=>{ready(ctx.input);stopped(ctx.signal);check(!lab.skeletonCandidate,'Apply the skeleton before calculating weights.');check(lab.document.joints.length,'Fit or predict a skeleton first.');lab.change(()=>autoBind(lab.base,lab.document));return character({weights:'local-distance-binding'});},
  reuse:async ctx=>{
   ready(ctx.input);stopped(ctx.signal);const recipe=await lab.rigEditor.store.get(ctx.config.templateId);stopped(ctx.signal);ready(ctx.input);check(recipe,'Choose a saved rig ID from the Rig shelf.');
   const bounds=new THREE.Box3().setFromObject(lab.base);
   // A flow may fit an empty character. Replacing an existing skeleton remains
   // an explicit undoable Rig shelf operation, outside an imported graph.
   lab.change(()=>{if(!lab.document.joints.length){const fitted=fitRigRecipe(recipe,lab.document,{min:bounds.min.toArray(),max:bounds.max.toArray()});lab.document=fitted.document;lab.detachAll();lab.selected=lab.document.joints[0]?.id;lab.clipId=lab.document.clips[0].id;lab.time=0;lab.poses={};}
    for(const source of recipe.actionDocument.clips.filter(c=>Object.values(c.tracks).some(k=>k.length))){const result=reuseRigAction(recipe,lab.document,source.id,{speed:ctx.config.speed||1,travelScale:ctx.config.scale??1});lab.document.clips.push(result.clip);lab.clipId=result.clip.id;}
   });return character({rigRecipeId:recipe.id});
  },
  equipment:async ctx=>{ready(ctx.input);stopped(ctx.signal);check(lab.equipmentEditor?.addFromConfig,'Equipment authoring is unavailable.');lab.equipmentEditor.addFromConfig(ctx.config);return character({equipmentItems:lab.document.equipment?.items.length||0});},
  motions:async ctx=>{
   ready(ctx.input);if(ctx.previousOutput)ready(ctx.previousOutput);check(!lab.skeletonCandidate,'Apply the skeleton before generating motion.');const completed=(ctx.previousOutput?.completed||[]).map(row=>({...row}));
   check(completed.length<=ctx.config.actions.length&&completed.every((row,index)=>row.index===index&&lab.document.clips.some(c=>c.id===row.clipId)),'A completed batch action was removed or changed. Start a new workflow run.');
   check(lab.document.clips.length+ctx.config.actions.length-completed.length<=32,'This batch exceeds the 32-action limit. Remove unused actions or reduce the batch.');
   try{
    // Each accepted clip is checkpointed before optional presentation settings.
    // A retry can finish those settings without generating that clip again.
    for(const row of completed){stopped(ctx.signal);const clip=lab.document.clips.find(c=>c.id===row.clipId);if(ctx.config.actions[row.index].loop&&!clip.loop)lab.change(()=>{lab.document.clips.find(c=>c.id===row.clipId).loop=true;});}
    for(let index=completed.length;index<ctx.config.actions.length;index++){
     stopped(ctx.signal);const spec=ctx.config.actions[index];ctx.progress?.(`Action ${index+1}/${ctx.config.actions.length}: ${spec.name}`);
     const result=await engineJob(ctx,async()=>{const options=await load(ctx);return lab.engine.generate({...options,...spec,guidanceScale:ctx.config.guidanceScale??3},lab.base,lab.document);});
     stopped(ctx.signal);const clip=lab.acceptMotion(result.motion,spec.name,{model:ctx.config.model,prompt:spec.prompt,seed:spec.seed??0,...(ctx.config.model==='unimate'?{guidanceScale:ctx.config.guidanceScale??3}:{})});
     completed.push({index,clipId:clip.id});ctx.checkpoint?.(character({completed:[...completed]}));
     if(spec.loop)lab.change(()=>{lab.document.clips.find(c=>c.id===clip.id).loop=true;});
    }
    return character({completed});
   }finally{if(ctx.config.unloadAfter&&lab.engine.client)try{await lab.engine.unload();}catch(e){ctx.progress?.('Actions retained; model unload failed: '+e.message);}}
  },
  review:async({signal,input})=>{ready(input);stopped(signal);check(!lab.skeletonCandidate,'Apply or discard the candidate before approving review.');return character({reviewed:true});},
  save:async ctx=>{ready(ctx.input);stopped(ctx.signal);if(ctx.config.name&&ctx.config.name!==lab.document.title)lab.change(()=>{lab.document.title=ctx.config.name;});if(lab.dirty||!lab.record?.asset?.id)await lab.save();ready(ctx.input);const output=character({saved:true});ctx.checkpoint?.(output);stopped(ctx.signal);return output;}
 };
}
