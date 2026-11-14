/** Portable workflow plans. Runtime outputs and licence decisions never enter a plan. */
import {modelById} from './models.mjs';
export const FLOW_FORMAT='capp.action-flow';
export const FLOW_STORAGE='capp.action-lab.flows.v1';
export const FLOW_LIMITS=Object.freeze({nodes:40,bytes:256*1024,actions:32});
const fail=(condition,message)=>{if(!condition)throw new Error(message);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const copy=v=>structuredClone(v);
const text=(v,fallback='',max=120)=>{const s=String(v??fallback).trim();fail(s.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s),'Workflow text is too long or contains control characters.');return s;};
const number=(v,fallback,min,max,integer=false)=>{const n=v??fallback;fail(typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n)),`Workflow value must be ${integer?'a whole number':'a number'} from ${min} to ${max}.`);return n;};
const choose=(v,fallback,values)=>{const s=v??fallback;fail(values.includes(s),'Unsupported workflow choice: '+String(s));return s;};
const modelId=v=>{const s=text(v,'triposr',80);fail(/^[a-z0-9][a-z0-9._-]*$/i.test(s),'Choose a valid model identifier.');return s;};
const seed=v=>number(v,0,0,2147483647,true);
const device=v=>choose(v,'auto',['auto','cuda','cpu']);
const pos=v=>({x:number(v?.x,40,-10000,10000),y:number(v?.y,40,-10000,10000)});
export const FLOW_TYPES=Object.freeze({
 current:{label:'Current character',input:null,output:'character',help:'Use the character open in Action Lab. Save a draft first if you want a checkpoint.'},
 reference:{label:'Character reference',input:null,output:'reference',help:'Use the reference image already selected in the 3D Generator. One character per run.'},
 model:{label:'Generate 3D model',input:'reference',output:'character',help:'Create a mesh from the selected image using the installed local model. Downloads and model licences require your consent for this run.'},
 predict:{label:'Predict skeleton',input:'character',output:'character',help:'UniRig proposes a skeleton. The original detailed mesh is retained. Apply joints is a separate step.'},
 accept:{label:'Apply joints & map body',input:'character',output:'character',help:'Apply the predicted joints and map anatomical roles. Pauses for review unless automatic application is enabled for this run. Invalid or incomplete maps still stop the run.'},
 bind:{label:'Bind smooth weights',input:'character',output:'character',help:'Calculate editable skin weights locally. Existing weights are replaced after review, or with this run’s automatic binding permission.'},
 reuse:{label:'Reuse saved rig',input:'character',output:'character',help:'Fit a saved rig template to this character. This reuses the skeleton; review its fit and bind this mesh before motion generation.'},
 motions:{label:'Generate action batch',input:'character',output:'character',help:'Generate named editable clips in sequence with UniMate or MoMask. The 32-action scene limit still applies. Check weapon contact and feet in review.'},
 equipment:{label:'Equip & hold item',input:'character',output:'character',help:'Create a reusable item or weapon profile, predict hand and holster anchors, and add editable equip, hold, use and holster clips locally. Review the contact and reach.'},
 review:{label:'Manual review',input:'character',output:'character',help:'Always pause. Hide the workflow to play the clips, inspect joints, weights and grip, then reopen it and continue.'},
 save:{label:'Save action draft',input:'character',output:'character',help:'Save the current mesh, rig, weights and action recipe to the personal library. Project publishing remains a separate reviewed action.'}
});
const baseAction={name:'Walk forward',prompt:'A person walks forward at a relaxed pace.',durationSeconds:4,seed:0,loop:true};
export function defaultFlowConfig(type){switch(type){case'model':return {model:'triposr',device:'auto',resolution:256,unloadAfter:true};case'predict':return {model:'unirig',device:'auto',seed:0,unloadAfter:true};case'accept':return {kind:'auto',facing:'auto'};case'bind':return {mode:'smooth'};case'reuse':return {templateId:'',scale:1};case'motions':return {model:'unimate',device:'auto',unloadAfter:true,actions:[copy(baseAction)]};case'equipment':return {category:'carry',name:'Carried item',massKg:2,dimensions:[.3,.25,.3],hand:'auto',actions:['equip','hold','use','holster'],carryLimitKg:25};case'save':return {name:''};default:return {};}}
function config(type,value={}){fail(object(value),'Node settings must be an object.');switch(type){
 case'model':{
  const model=modelId(value.model),resolution=number(value.resolution,256,64,1024,true),spec=modelById(model);
  fail(!spec||spec.resolutions.includes(resolution),'Choose a mesh resolution supported by this model.');
  const result={model,device:device(value.device),resolution,unloadAfter:value.unloadAfter!==false};
  if(model!=='triposr')Object.assign(result,{seed:seed(value.seed),steps:number(value.steps,30,10,75,true)});
  if(model.startsWith('hunyuan3d-')&&value.imagePadding!==undefined)result.imagePadding=number(value.imagePadding,.15,.05,.25);
  if(model.startsWith('hunyuan3d-'))Object.assign(result,{guidanceScale:number(value.guidanceScale,5,0,20),memoryMode:choose(value.memoryMode,'gpu',['gpu','cpu-offload']),numChunks:number(value.numChunks,8000,1000,32000,true)});
  return result;
 }
 case'predict':return {model:'unirig',device:device(value.device),seed:seed(value.seed),unloadAfter:value.unloadAfter!==false};
 case'accept':return {kind:choose(value.kind,'auto',['auto','humanoid','quadruped']),facing:choose(value.facing,'auto',['auto','+Z','-Z','+X','-X'])};
 case'bind':return {mode:choose(value.mode,'smooth',['smooth'])};
 case'reuse':return {templateId:text(value.templateId,'',120),scale:number(value.scale,1,0,4),speed:number(value.speed,1,.1,4)};
 case'motions':{const model=choose(value.model,'unimate',['unimate','momask']);const actions=value.actions??[baseAction];fail(Array.isArray(actions)&&actions.length>0&&actions.length<=FLOW_LIMITS.actions,'Add 1–32 actions to the batch.');return {model,device:device(value.device),unloadAfter:value.unloadAfter!==false,actions:actions.map((a,i)=>{fail(object(a),'Each batch action needs settings.');const name=text(a.name,'Action '+(i+1)),prompt=text(a.prompt,'',2000);fail(name&&prompt,'Each action needs a name and movement description.');return {name,prompt,durationSeconds:number(a.durationSeconds,4,.5,model==='momask'?9.6:60),seed:seed(a.seed),loop:!!a.loop};})};}
 case'save':return {name:text(value.name)};
 case'equipment':{const defaults=defaultFlowConfig(type),dimensions=value.dimensions??defaults.dimensions,actions=value.actions??defaults.actions;fail(Array.isArray(dimensions)&&dimensions.length===3,'Item dimensions need width, height and depth.');fail(Array.isArray(actions)&&actions.length>0&&actions.length<=4&&new Set(actions).size===actions.length,'Choose 1–4 distinct equipment actions.');return {category:choose(value.category,'carry',['carry','pistol','rifle','sword','knife','axe','spear','bow','shield']),name:text(value.name,'Carried item')||'Carried item',massKg:number(value.massKg,2,0,1000),dimensions:dimensions.map(n=>number(n,.3,.001,100)),hand:choose(value.hand,'auto',['auto','left','right','both']),actions:actions.map(a=>choose(a,'hold',['equip','hold','use','holster'])),carryLimitKg:number(value.carryLimitKg,25,.1,1000)};}
 default:return {};
}}
export function createFlowNode(type,index=0){fail(Object.hasOwn(FLOW_TYPES,type),'Unknown workflow node.');return {id:'node-'+globalThis.crypto.randomUUID(),type,label:FLOW_TYPES[type].label,position:{x:40+(index%3)*248,y:40+Math.floor(index/3)*140},config:defaultFlowConfig(type)};}
export function normalizeFlow(value,{runnable=false}={}){
 fail(object(value)&&value.format===FLOW_FORMAT&&value.version===1,'Use an Action Lab workflow, version 1.');
 fail(Array.isArray(value.nodes)&&value.nodes.length<=FLOW_LIMITS.nodes,'Use no more than 40 workflow nodes.');
 fail(Array.isArray(value.edges)&&value.edges.length<=FLOW_LIMITS.nodes,'Use no more than 40 workflow connections.');
 const ids=new Set(),nodes=value.nodes.map((n,i)=>{fail(object(n)&&Object.hasOwn(FLOW_TYPES,n.type),'Unknown workflow node type.');const id=text(n.id,'',100);fail(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)&&!ids.has(id),'Node identifiers must be unique letters, numbers, dashes or underscores.');ids.add(id);return {id,type:n.type,label:text(n.label,FLOW_TYPES[n.type].label)||FLOW_TYPES[n.type].label,position:pos(n.position??{x:40+(i%3)*248,y:40+Math.floor(i/3)*140}),config:config(n.type,n.config)};});
 const byId=new Map(nodes.map(n=>[n.id,n])),incoming=new Set(),outgoing=new Set();
 const edges=value.edges.map(e=>{fail(object(e)&&byId.has(e.from)&&byId.has(e.to),'Every connection must join two existing nodes.');fail(e.from!==e.to&&!incoming.has(e.to)&&!outgoing.has(e.from),'Use one incoming and one outgoing connection per node.');const a=byId.get(e.from),b=byId.get(e.to);fail(FLOW_TYPES[a.type].output===FLOW_TYPES[b.type].input,'Connect matching ports: references feed model generation; characters feed rig, motion, review and save.');incoming.add(e.to);outgoing.add(e.from);return {from:e.from,to:e.to};});
 const next=new Map(edges.map(e=>[e.from,e.to]));
 for(const n of nodes){const visited=new Set();for(let id=n.id;id;id=next.get(id)){fail(!visited.has(id),'Workflows cannot contain a cycle.');visited.add(id);}}
 if(runnable){fail(nodes.length>0,'Add a source node to the workflow.');const sources=nodes.filter(n=>!FLOW_TYPES[n.type].input);fail(sources.length===1,'Use exactly one Current character or Character reference source.');fail(edges.length===nodes.length-1,'Connect every node into a single character workflow.');fail(!incoming.has(sources[0].id),'The source must start the workflow.');for(const n of nodes)if(n!==sources[0])fail(incoming.has(n.id),'Connect '+n.label+' to the workflow.');}
 const result={format:FLOW_FORMAT,version:1,name:text(value.name,'My character workflow',100)||'My character workflow',nodes,edges};fail(new TextEncoder().encode(JSON.stringify(result,null,2)).length<=FLOW_LIMITS.bytes,'The workflow exceeds 256 KiB.');return result;
}
export function parseFlow(source){fail(typeof source==='string'&&new TextEncoder().encode(source).length<=FLOW_LIMITS.bytes,'Workflow files must be 256 KiB or smaller.');return normalizeFlow(JSON.parse(source));}
export function stringifyFlow(value){const result=JSON.stringify(normalizeFlow(value),null,2);fail(new TextEncoder().encode(result).length<=FLOW_LIMITS.bytes,'The workflow exceeds 256 KiB.');return result;}
export function flowOrder(value){const f=normalizeFlow(value,{runnable:true}),byId=new Map(f.nodes.map(n=>[n.id,n])),next=new Map(f.edges.map(e=>[e.from,e.to])),result=[];let n=f.nodes.find(n=>!FLOW_TYPES[n.type].input);while(n){result.push(n);n=byId.get(next.get(n.id));}return result;}
export function requiredFlowModels(value){return [...new Set(normalizeFlow(value).nodes.filter(n=>['model','predict','motions'].includes(n.type)).map(n=>n.config.model))];}
export function flowPreset(kind='character'){
 const types=kind==='reference'?['reference','model','predict','accept','bind','motions','review','save']:kind==='reuse'?['current','reuse','accept','bind','motions','review','save']:kind==='actions'?['current','motions','review','save']:['current','predict','accept','bind','motions','review','save'];
 const nodes=types.map(createFlowNode);const motion=nodes.find(n=>n.type==='motions');motion.config.actions=[copy(baseAction),{name:'Idle',prompt:'A person stands relaxed, breathing gently.',durationSeconds:4,seed:1,loop:true}];
 return {format:FLOW_FORMAT,version:1,name:kind==='reference'?'Reference to reviewed character':kind==='reuse'?'Shared rig to new character':kind==='actions'?'Add an action batch':'Character to reviewed actions',nodes,edges:nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id}))};
}

/** Adapter contract:
 * adapters[type]({node, config, input, signal, policy, approved, attempt,
 *   previousOutput, progress(message), checkpoint(output)}) -> {kind, ...}
 * Outputs stay in memory. Return the input token after an in-place operation.
 * checkpoint stores partial work for retry (e.g. generated clip IDs).
 * Check signal before committing asynchronous results. The runner also refuses
 * late results after cancellation. A missing adapter is a preflight error.
 */
export class ActionFlowRunner {
 constructor(adapters={}, {onChange=()=>{}}={}){this.adapters=adapters;this.onChange=onChange;this.status='idle';this.nodes=new Map();this.nodeId=null;this.message='Ready to run.';this.serial=0;}
 get active(){return ['running','paused','failed'].includes(this.status);}
 state(){return {status:this.status,nodeId:this.nodeId,message:this.message,nodes:[...this.nodes].map(([id,v])=>({id,status:v.status,message:v.message,attempt:v.attempt,summary:typeof v.output?.summary==='string'?v.output.summary:null}))};}
 emit(){this.onChange(this.state());}
 async start(value,policy={}){
  fail(!this.active,'Finish or cancel the current workflow before starting another.');const plan=normalizeFlow(value,{runnable:true}),order=flowOrder(plan);
  for(const n of order)fail(typeof this.adapters[n.type]==='function',`“${n.label}” is unavailable in this app. No workflow steps were run.`);
  const required=requiredFlowModels(plan),accepted=new Set(Array.isArray(policy.acceptedModels)?policy.acceptedModels:[]);for(const id of required)fail(accepted.has(id),`Accept the terms for ${id} for this run before starting.`);
  this.policy=Object.freeze({acceptedModels:Object.freeze(required),autoApplyJoints:policy.autoApplyJoints===true,autoBindWeights:policy.autoBindWeights===true});this.plan=plan;this.order=order;this.index=0;this.nodes=new Map(order.map(n=>[n.id,{status:'pending',message:'Waiting',attempt:0,output:undefined}]));this.controller=new AbortController();this.serial++;this.status='running';this.message='Starting workflow…';this.emit();return this.advance();
 }
 async advance(approved=false){const serial=this.serial;this.status='running';for(;this.index<this.order.length;this.index++){
   if(serial!==this.serial||this.controller.signal.aborted)return this.state();
   const node=this.order[this.index],state=this.nodes.get(node.id);this.nodeId=node.id;
   const gate=node.type==='review'||node.type==='accept'&&!this.policy.autoApplyJoints||node.type==='bind'&&!this.policy.autoBindWeights;
   if(gate&&!approved){state.status='paused';state.message=node.type==='review'?'Review the character and clips, then Continue.':node.type==='accept'?'Inspect the predicted skeleton. Continue applies joints and the body map.':'Check the rig fit. Continue replaces the mesh’s smooth weights.';this.status='paused';this.message=state.message;this.emit();return this.state();}
   state.status='running';state.attempt++;state.message='Running '+node.label+'…';this.message=state.message;this.emit();
   const input=this.index?this.nodes.get(this.order[this.index-1].id).output:undefined;
   const alive=()=>serial===this.serial&&!this.controller.signal.aborted;
   try{
    const output=await this.adapters[node.type]({node:copy(node),config:copy(node.config),input,signal:this.controller.signal,policy:this.policy,approved:approved||!gate,attempt:state.attempt,previousOutput:state.output,progress:message=>{if(alive()){state.message=String(message).slice(0,2000);this.message=state.message;this.emit();}},checkpoint:output=>{if(alive()){this.checkOutput(node,output);state.output=output;}}});
    if(!alive())return this.state();this.checkOutput(node,output);state.output=output;state.status='done';state.message=output.summary||'Completed';this.emit();
   }catch(error){if(!alive())return this.state();state.status='failed';state.message=error?.message||String(error);this.status='failed';this.message=node.label+': '+state.message;this.emit();return this.state();}
   approved=false;
  }
  this.status='completed';this.nodeId=null;this.message='Workflow complete. Review the results before publishing.';this.emit();return this.state();
 }
 checkOutput(node,output){fail(object(output)&&output.kind===FLOW_TYPES[node.type].output,`“${node.label}” did not return a valid ${FLOW_TYPES[node.type].output} result.`);}
 async resume(){fail(this.status==='paused','This workflow is not waiting for review.');return this.advance(true);}
 async retry(){fail(this.status==='failed','There is no failed step to retry.');return this.advance(true);}
 cancel(){if(!this.active)return this.state();this.serial++;this.controller.abort();const s=this.nodes.get(this.nodeId);if(s&&['running','paused','failed'].includes(s.status)){s.status='cancelled';s.message='Cancelled. Completed scene edits are retained.';}this.status='cancelled';this.message='Cancelled. Completed edits remain available for review and Undo.';this.emit();return this.state();}
}
