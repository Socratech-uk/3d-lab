import {ACTION_PROMPTS,PromptLibrary,normalizePrompt} from './action-prompts.mjs';
import {ACTION_MODELS} from './action-engine.mjs';
import {motionRigStatus} from './action-anatomy.mjs';

const $=id=>document.getElementById(id);
const comparable=value=>JSON.stringify(normalizePrompt(value,{allowEmpty:true}));
const recipe=value=>({name:value.name,prompt:value.prompt,actionName:value.actionName??value.name,durationSeconds:value.durationSeconds,seed:value.seed});
export function motionReadiness({document,model,loaded,licenseAccepted,prompt,durationSeconds,seed,guidanceScale=3,pending=false,name='',actionName=''}){
 const issues=[],info=ACTION_MODELS.find(m=>m.id===model);
 try{normalizePrompt({name,actionName,prompt,durationSeconds,seed},{allowEmpty:true});}catch(error){issues.push(error.message);}
 if(!info||info.task!=='motion')issues.push('Choose UniMate or MoMask for motion generation.');
 const rig=motionRigStatus(document,model),joints=rig.joints,roots=joints.filter(j=>j.parent==null),names=new Set(joints.map(j=>j.name.trim().toLowerCase()));
 issues.push(...rig.issues);
 const maxJoints=model==='momask'?128:70;
 if(joints.length<5||joints.length>maxJoints||roots.length!==1||names.size!==joints.length||joints.some(j=>!j.name.trim()))issues.push(`Fit one connected motion rig with 5–${maxJoints} uniquely named joints.`);
 if(!Object.values(document?.bindings||{}).some(b=>['skin','rigid'].includes(b.mode)))issues.push('Bind the mesh in Rig so it follows the generated motion.');
 if(!licenseAccepted)issues.push('Read and accept the model licence in Engine & setup.');
 if(!loaded)issues.push('Load '+(model==='momask'?'MoMask':'UniMate')+' in Engine & setup.');
 if(!String(prompt||'').trim()||String(prompt).length>2000)issues.push('Describe the movement in 1–2,000 characters.');
 if(!Number.isFinite(durationSeconds)||durationSeconds<.5||durationSeconds>(info?.maxDuration||60))issues.push(`Choose a length from 0.5 to ${info?.maxDuration||60} seconds.`);
 if(model==='unimate'&&(!Number.isFinite(guidanceScale)||guidanceScale<1||guidanceScale>7))issues.push('Choose guidance from 1 to 7.');
 if(!Number.isInteger(seed)||seed<0||seed>2147483647)issues.push('Use a whole seed from 0 to 2147483647.');
 if(pending)issues.push('Finish or cancel the active editing gesture first.');
 if(document?.clips.length>=32)issues.push('This scene already has 32 actions. Remove an action before generating another.');
 const existing=(document?.clips||[]).reduce((n,c)=>n+Object.values(c.tracks).reduce((s,k)=>s+k.length,0),0);
 if(Number.isFinite(durationSeconds)&&existing+(Math.ceil(durationSeconds*(info?.fps||30))+1)*(joints.length+1)>180000)issues.push('This would exceed the scene’s key limit. Shorten the action or remove existing actions first.');
 return issues;
}
export function skeletonReadiness({loaded,licenseAccepted,seed,device,pending=false,meshStats,skeletonCandidate=false}){
 const issues=[];
 if(skeletonCandidate)issues.push('Apply or discard the current skeleton candidate first.');
 if(!meshStats||!Number.isSafeInteger(meshStats.vertices)||meshStats.vertices<3||meshStats.triangles<=0||!Number.isSafeInteger(meshStats.triangles))issues.push('Choose a mesh with complete triangles for automatic preparation.');
 if(!licenseAccepted)issues.push('Read and accept the model licence in Engine & setup.');
 if(!loaded)issues.push('Load UniRig in Engine & setup.');
 if(!Number.isInteger(seed)||seed<0||seed>2147483647)issues.push('Use a whole seed from 0 to 2147483647.');
 if(pending)issues.push('Finish or cancel the active editing gesture first.');
 return issues;
}

export class ActionComposer{
 constructor({notify,download,onChange=()=>{},storage}){
  Object.assign(this,{notify,download,onChange,context:null,activityBusy:false,resultId:null,completedMessage:'',storageMessage:''});
  if(!storage)try{storage=window.localStorage;}catch{}
  this.storage=storage;
  document.addEventListener('draft-storage-status',()=>this.storageState());
  this.library=new PromptLibrary(storage);this.loaded=this.library.state.selected;
  this.fill(this.library.state.draft);this.populate();this.baseline=this.source(this.loaded);this.storageState();
  const act=(id,fn)=>$(id).onclick=()=>{try{const result=fn();if(result?.catch)result.catch(e=>this.fail(e));}catch(e){this.fail(e);}};
  act('a-ai-load-prompt',()=>this.load($('a-ai-preset').value));
  act('a-ai-blank-prompt',()=>{if(!this.canReplace())return;this.loaded='';this.baseline={name:'',prompt:'',actionName:'',durationSeconds:6,seed:0};this.fill(this.baseline);this.populate();this.changed();$('a-ai-prompt').focus();});
  $('a-ai-preset').onchange=()=>{$('a-ai-library-hint').textContent='Choose Load prompt to replace the editor. Your current text is unchanged.';};
  for(const id of ['a-ai-prompt','a-ai-prompt-name','a-ai-action-name','a-ai-duration','a-ai-seed','a-ai-guidance'])$(id).addEventListener('input',()=>this.changed());
  document.querySelectorAll('[data-action-duration]').forEach(b=>b.onclick=()=>{$('a-ai-duration').value=b.dataset.actionDuration;this.changed();});
  act('a-ai-save-prompt',()=>this.save(false));act('a-ai-update-prompt',()=>this.save(true));
  act('a-ai-duplicate-prompt',async()=>{const entry=this.library.duplicate(this.current());await this.storage?.flush?.();this.afterSave(entry,'Saved a separate copy.');});
  act('a-ai-delete-prompt',async()=>{const selected=this.saved();if(!selected)return;if(!confirm('Delete saved prompt “'+selected.name+'”? The text in the editor will remain.'))return;this.library.remove(selected.id);await this.storage?.flush?.();this.loaded='';this.populate();this.storageMessage='Saved prompt deleted. The editor text is retained.';this.storageState();this.refresh();});
  act('a-ai-export-prompts',()=>{this.download(this.library.export(),'action-prompts.json','application/json');this.storageMessage='Prompt library exported, including the latest valid editor draft.';this.storageState();});
  act('a-ai-import-prompts',()=>$('a-ai-prompt-file').click());
  $('a-ai-prompt-file').onchange=async()=>{const file=$('a-ai-prompt-file').files[0];$('a-ai-prompt-file').value='';if(!file)return;try{if(file.size>256*1024)throw new Error('Prompt libraries must be smaller than 256 KiB.');const added=this.library.import(await file.text());await this.storage?.flush?.();this.populate();this.storageMessage='Imported '+added+' prompts. Existing prompts and the editor were kept.';this.storageState();this.refresh();}catch(error){this.fail(error);}};
  act('a-ai-random-seed',()=>{const seed=new Uint32Array(1);crypto.getRandomValues(seed);$('a-ai-seed').value=seed[0]&0x7fffffff;this.changed();});
  this.changed(false);
 }
 current(){return {prompt:$('a-ai-prompt').value,name:$('a-ai-prompt-name').value,actionName:$('a-ai-action-name').value,durationSeconds:$('a-ai-duration').value.trim()?Number($('a-ai-duration').value):NaN,seed:$('a-ai-seed').value.trim()?Number($('a-ai-seed').value):NaN};}
 options(){return {...this.current(),guidanceScale:Number($('a-ai-guidance').value),model:$('a-ai-model').value,device:$('a-ai-device').value,licenseAccepted:$('a-ai-license').checked};}
 source(key){if(key?.startsWith('preset:'))return recipe(ACTION_PROMPTS.find(v=>'preset:'+v.id===key)||ACTION_PROMPTS[0]);if(key?.startsWith('saved:')){const item=this.library.state.entries.find(v=>'saved:'+v.id===key);if(item)return recipe(item);}return null;}
 saved(){return this.library.state.entries.find(v=>'saved:'+v.id===this.loaded)||null;}
 fill(value){for(const [id,key]of [['a-ai-prompt','prompt'],['a-ai-prompt-name','name'],['a-ai-action-name','actionName'],['a-ai-duration','durationSeconds'],['a-ai-seed','seed']])$(id).value=value[key]??'';}
 populate(){const select=$('a-ai-preset'),placeholder=new Option('Choose a starter or saved prompt…','');select.replaceChildren(placeholder);for(const group of [...new Set(ACTION_PROMPTS.map(p=>p.group))]){const node=document.createElement('optgroup');node.label=group;node.append(...ACTION_PROMPTS.filter(p=>p.group===group).map(p=>new Option(p.name,'preset:'+p.id)));select.append(node);}if(this.library.state.entries.length){const node=document.createElement('optgroup');node.label='Your saved prompts';node.append(...this.library.state.entries.map(p=>new Option(p.name,'saved:'+p.id)));select.append(node);}select.value=this.loaded||'';const source=this.source(this.loaded);$('a-ai-library-hint').textContent=source?'Loaded “'+source.name+'”. Edit it below; the saved source stays unchanged.':'Current editor draft. Choose a starter or saved prompt, then Load prompt.';$('a-ai-saved-count').textContent=this.library.state.entries.length+'/48';}
 canReplace(){let changed=true;try{changed=!this.baseline||comparable(this.current())!==comparable(this.baseline);}catch{}return !changed||confirm('Replace the current prompt editor contents? Save it as a prompt first if you want to keep this version.');}
 load(key){const source=this.source(key);if(!key||!source)throw new Error('Choose a starter or saved prompt first.');if(!this.canReplace())return;this.loaded=key;this.baseline=source;this.fill(source);this.changed();$('a-ai-library-hint').textContent='Loaded “'+source.name+'”. Edit it below; the saved source stays unchanged.';}
 changed(persist=true){if(persist){try{this.library.draft(this.current(),this.loaded);this.storageMessage=this.library.error||'Editor draft kept on this device.';}catch(error){this.storageMessage=error.message+' The last valid draft is retained.';}}this.storageState();this.refresh();this.onChange();}
 async save(update){const current=this.current(),saved=this.saved();if(update&&!saved)throw new Error('Load a saved prompt before using Update saved.');const entry=this.library.save(current,update?saved.id:null);await this.storage?.flush?.();this.afterSave(entry,update?'Saved prompt updated on disk.':'Added to your saved prompts on disk.');}
 afterSave(entry,message){this.loaded='saved:'+entry.id;this.baseline=recipe(entry);this.fill(entry);this.populate();this.storageMessage=message;this.storageState();this.refresh();}
 storageState(){const node=$('a-ai-storage-state');node.textContent=this.library.error||this.storage?.message||this.storageMessage||'Editor draft is kept on this device.';node.classList.toggle('is-error',!!this.library.error||!!this.storage?.message?.includes('NOT saved'));}
 fail(error){this.storageMessage=error.message;$('a-ai-storage-state').textContent=error.message;$('a-ai-storage-state').classList.add('is-error');this.notify(error.message,true);}
 activity(message,detail={}){$('a-ai-state').textContent=message;if(Number.isFinite(detail.fraction))$('a-ai-progress').value=Math.max(0,Math.min(1,detail.fraction));else $('a-ai-progress').removeAttribute('value');if(this.context)this.refresh();}
 markSaved(doc){if(this.resultId&&doc.clips.some(c=>c.id===this.resultId))$('a-ai-state').textContent='Action draft saved with the rig and all named actions.';}
 succeeded(clip){this.resultId=clip.id;this.completedMessage='“'+clip.name+'” added as editable keys. Preview the result, then Save draft to keep it.';$('a-ai-state').textContent=this.completedMessage;$('a-ai-progress').value=1;this.refresh();}
 refresh(context=this.context){
  if(context)this.context=context;const value=this.current(),selectedModel=$('a-ai-model').value,info=ACTION_MODELS.find(v=>v.id===selectedModel)||ACTION_MODELS[0],rigging=info.task==='rig';
  $('a-ai-char-count').textContent=value.prompt.length+' / 2000';$('a-ai-motion-fields').hidden=rigging;
  $('a-ai-kind').textContent=rigging?'MESH → SKELETON':'TEXT → ACTION';$('a-ai-heading').textContent=rigging?'Find the joints.':'What should it do?';$('a-ai-intro').textContent=rigging?'Predict from the mesh, then inspect and edit the skeleton before applying it.':'Describe one movement, generate it on your rig, then refine the keys.';
  $('a-ai-prompt-hint').textContent=selectedModel==='momask'?'MoMask: describe one precise human movement, for example “A person runs forward.” Preview the full action.':'UniMate: use a short action, for example “An object runs forward.”';
  $('a-ai-duration').max=info.maxDuration||60;$('a-ai-duration-limits').textContent=`0.5–${info.maxDuration||60} seconds`;
  document.querySelectorAll('[data-action-duration]').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.dataset.actionDuration)===value.durationSeconds));b.hidden=Number(b.dataset.actionDuration)>(info.maxDuration||60);});
  $('a-ai-guidance-field').hidden=selectedModel!=='unimate';$('a-ai-guidance-note').hidden=selectedModel!=='unimate';$('a-ai-motion-tips').hidden=rigging;
  const seconds=value.durationSeconds,segments=seconds<=2?1:1+Math.ceil((Math.ceil(seconds*30)+1-60)/48);
  $('a-ai-duration-note').textContent=!Number.isFinite(seconds)||seconds<.5||seconds>(info.maxDuration||60)?`Enter 0.5–${info.maxDuration||60} seconds.`:selectedModel==='momask'?'One HumanML3D humanoid action at native 20 FPS. Maximum 9.6 seconds.':seconds<=2?'One neural segment. Good for a quick movement test.':`About ${segments} overlapping neural segments. Longer actions take more time; review transitions and foot contacts.`;
  const saved=this.saved(),busy=!!context?.busy;$('a-ai-update-prompt').disabled=busy||!saved;$('a-ai-delete-prompt').disabled=busy||!saved;
  if(!context)return;const {engine,document:doc,pending,meshStats,skeletonCandidate}=context,options=this.options(),row=engine.catalog?.models?.find(v=>v.id===options.model),loaded=engine.isLoaded(options),issues=rigging?skeletonReadiness({...options,loaded,pending,meshStats,skeletonCandidate}):motionReadiness({...options,document:doc,loaded,pending});
  if(skeletonCandidate&&!rigging)issues.unshift('Apply or discard the skeleton candidate before generating motion.');
  if(row&&!row.available&&!loaded)issues.unshift(row.setupReason||'Enable this model in cApp and freshly Compile and Package the app.');
  $('a-ai-setup-badge').textContent=loaded?'Loaded':row?.available?'Ready to load':row?.setupReason?'Setup required':engine.catalog?'Not installed':'Check required';
  const jointCount=doc?.joints.length||0,bound=Object.values(doc?.bindings||{}).filter(b=>['skin','rigid'].includes(b.mode)).length,rig=rigging?null:motionRigStatus(doc,selectedModel);
  const checks=[rigging?{ok:!!meshStats&&Number.isSafeInteger(meshStats.vertices)&&meshStats.vertices>=3&&Number.isSafeInteger(meshStats.triangles)&&meshStats.triangles>0,label:`${(meshStats?.vertices||0).toLocaleString()} vertices · ${(meshStats?.triangles||0).toLocaleString()} triangles${meshStats?.vertices>20000||meshStats?.triangles>40000?' · automatic prediction copy':''}`}:{ok:!rig.issues.length&&rig.joints.length>=5&&bound>0,label:rig.issues.length?'Body map needs review':`${rig.joints.length} motion joints · ${jointCount} detailed joints · ${bound} bound parts`},{ok:loaded&&options.licenseAccepted,label:loaded?(options.licenseAccepted?info.name.split(' · ')[0]+' loaded · licence accepted':'Model loaded · accept licence'):'Load '+info.name.split(' · ')[0]+' in Engine & setup'}];
  $('a-ai-map-body').hidden=rigging;$('a-ai-map-body').disabled=busy||!jointCount;
  $('a-ai-checklist').replaceChildren(...checks.map(item=>{const li=document.createElement('li');li.className=item.ok?'is-ready':'is-pending';li.textContent=(item.ok?'✓ ':'○ ')+item.label;return li;}));
  $('a-ai-readiness').textContent=busy?(engine.busy?(engine.operation==='prepare'?'Preparing the local model. You can stop this operation.':engine.operation==='proxy'?'Preparing a temporary prediction copy. The detailed model is retained.':'Generating locally. You can stop this operation.'):'Saving your action…'):issues[0]||(rigging?meshStats?.vertices>20000||meshStats?.triangles>40000?'Ready. A temporary copy will be simplified automatically. Joints are placed on your original detailed model for review.':'Ready. Generates an editable candidate on your original mesh; your existing rig is kept until you apply.':'Ready. Generates a new action and preserves your existing actions.');
  $('a-ai-generate').disabled=busy||issues.length>0;$('a-ai-generate').title=issues[0]||'Generate a new action; existing actions stay available';$('a-ai-prepare').disabled=busy||!options.licenseAccepted||row?.available===false;$('a-ai-rig').disabled=busy||issues.length>0;$('a-ai-unload').disabled=busy||!loaded;
  $('a-ai-stop').textContent=['prepare','proxy'].includes(engine.operation)?'Stop preparation':'Stop generation';$('a-ai-stop').disabled=!engine.busy;$('a-ai-progress-wrap').hidden=!engine.busy;$('a-ai-generate').textContent=engine.busy?'Working…':'Generate action';$('a-ai-result-actions').hidden=rigging||!this.resultId||!doc.clips.some(c=>c.id===this.resultId);
 }
}
