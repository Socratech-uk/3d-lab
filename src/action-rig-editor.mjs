import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check} from './core.mjs';
import {sampleClip} from './action-geometry.mjs';
import {createRigRecipe,fitRigRecipe,parseRigRecipe,reuseRigAction,rigCompatibility,RigRecipeStore,RIG_SHELF_LIMITS} from './action-rig-library.mjs';

const $=id=>document.getElementById(id);
export function actionRigMarkup(){return `<section class="action-rig-library" aria-label="Reusable rigs and actions">
<span class="eyebrow">BUILD ONCE · REUSE ACROSS CHARACTERS</span><h3>Your rig & action shelf</h3>
<p class="helper">Save a character’s skeleton and actions as a reusable recipe. Fit that rig to another body, calculate new weights, then reuse its actions without generating each movement again.</p>
<ol class="rig-reuse-steps"><li><strong>Save a good rig.</strong> Include reviewed actions from the current character.</li><li><strong>Fit another character.</strong> Check joints and bind fresh skin weights.</li><li><strong>Reuse and vary.</strong> Copy an action, change its speed or root travel, and review it.</li></ol>
<label class="field">Recipe name<input id="ar-name" maxlength="120" placeholder="Civilian humanoid · walking set"></label>
<div class="rig-library-row"><button id="ar-save">Save this rig & actions</button><button id="ar-import">Import recipe…</button></div>
<input id="ar-file" type="file" accept=".json,application/json" hidden>
<p class="helper">The shelf is saved to your permanent asset folder. Export recipes to share them. Geometry, skin weights and equipment are kept with their character draft.</p>
<label class="field">Saved recipe<select id="ar-recipe"><option value="">No saved recipes yet</option></select></label>
<div class="rig-library-row"><button id="ar-refresh">Refresh shelf</button><button id="ar-export">Export recipe</button><button id="ar-remove">Remove</button></div>
<p id="ar-summary" class="helper"></p>
<details open><summary>Fit the skeleton to this character</summary>
<p class="helper">Uniformly scales the saved rig to this model’s height and grounds it to the model bounds. Joint IDs, hierarchy and rest rotations stay intact. Adjust different proportions by hand, review the body map, then bind new weights.</p>
<label class="consent rig-replace-consent"><input id="ar-replace" type="checkbox">Replace this character’s existing skeleton, actions, weights and equipment setup. Undo is available.</label>
<button id="ar-fit">Fit saved skeleton</button><p class="helper">A copied skeleton does not copy the source character’s skin weights. Once fitted, use Rig → Calculate smooth weights and Body map → Review.</p></details>
<details open><summary>Reuse an action or create a variation</summary>
<p id="ar-compatibility" class="rig-compatibility" role="status">Save or choose a recipe to see compatibility.</p>
<label class="field">Saved action<select id="ar-clip"><option value="">No keyed actions</option></select></label>
<label class="field">New action name<input id="ar-action-name" maxlength="120" placeholder="Walk · relaxed"></label>
<div class="rig-library-pair"><label class="field">Speed multiplier<input id="ar-speed" type="number" min="0.1" max="4" step="0.05" value="1"></label><label class="field">Root travel multiplier<input id="ar-travel" type="number" min="0" max="4" step="0.05" value="1"></label></div>
<p class="helper">Speed 0.8 is slower; 1.2 is faster. Travel changes only horizontal root displacement; 0 keeps that root in place. It cannot add travel to an in-place clip. Foot contacts and event timing follow speed changes. Review feet and recalibrate stride after size changes.</p>
<button id="ar-reuse">Add action to this character</button></details>
<p id="ar-status" class="rig-library-status helper" role="status" aria-live="polite">Loading saved rigs…</p></section>`;}
const boundsOf=base=>{const bounds=new THREE.Box3().setFromObject(base);return {min:bounds.min.toArray(),max:bounds.max.toArray()};};
const number=id=>{check($(id).value.trim(),'Enter a value for the variation.');return Number($(id).value);};
const download=(value,name)=>{const url=URL.createObjectURL(new Blob([value],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').slice(0,120)+'.rig.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

export class ActionRigEditor {
 constructor(lab,{store=new RigRecipeStore()}={}){
  this.lab=lab;this.store=store;this.rows=[];this.recipe=null;this.loading=false;this.loadSequence=0;this.message='';this.lastDocument=null;
  const panel=document.querySelector('[data-action-panel=reuse]');check(panel,'Mount actionRigMarkup() in the reuse panel first.');if(!$('ar-recipe'))panel.insertAdjacentHTML('beforeend',actionRigMarkup());
  const act=(id,fn)=>$(id).onclick=()=>lab.run(async()=>{lab.checkReplacement();try{return await fn();}catch(error){this.report(error.message,true);throw error;}});
  act('ar-save',()=>this.saveCurrent());act('ar-refresh',()=>this.refresh());act('ar-fit',()=>this.fit());act('ar-reuse',()=>this.reuse());
  act('ar-import',()=>$('ar-file').click());act('ar-export',()=>{check(this.recipe,'Choose a saved rig.');download(JSON.stringify(this.recipe,null,2),this.recipe.name);this.report('Recipe exported. Keep it with your character sources to restore the shelf in another browser.');});
  act('ar-remove',async()=>{check(this.recipe,'Choose a saved rig.');if(!confirm('Remove “'+this.recipe.name+'” from the rig shelf? Earlier disk versions are retained. Character drafts are unaffected.'))return;await this.store.remove(this.recipe.id);this.recipe=null;await this.refresh();this.report('Recipe removed from the shelf.');});
  $('ar-file').onchange=()=>lab.run(async()=>{const file=$('ar-file').files[0];$('ar-file').value='';if(!file)return;try{check(file.size<=RIG_SHELF_LIMITS.recipeBytes,'Use a rig or action recipe up to 24 MiB.');const recipe=parseRigRecipe(await file.text());await this.store.save(recipe);await this.refresh(recipe.id);this.report('Imported “'+recipe.name+'”. The current character is unchanged; choose Fit or Add action when ready.');}catch(error){this.report(error.message,true);throw error;}});
  $('ar-recipe').onchange=()=>lab.run(()=>this.select($('ar-recipe').value));$('ar-replace').onchange=()=>this.render();
  $('ar-clip').onchange=()=>{const clip=this.recipe?.actionDocument.clips.find(c=>c.id===$('ar-clip').value);$('ar-action-name').value=clip?(clip.name+' · reused').slice(0,120):'';};
  this.ready=this.refresh().catch(error=>this.report(error.message,true));
 }
 report(message,error=false){this.message=message;$('ar-status').textContent=message;$('ar-status').classList.toggle('error',error);}
 async refresh(preferred=this.recipe?.id){
  this.loading=true;this.render();
  try{this.rows=await this.store.list();const id=this.rows.some(r=>r.id===preferred)?preferred:this.rows[0]?.id;
   $('ar-recipe').replaceChildren(...(this.rows.length?this.rows.map(r=>new Option(r.name,r.id)):[new Option('No saved recipes yet','')]));await this.select(id||'');if(!this.message)this.report(this.rows.length?`${this.rows.length} saved rig recipe${this.rows.length===1?'':'s'}.`:'Save the current rig or import a recipe to start your shelf.');
  }finally{this.loading=false;this.render();}
 }
 async select(id){
  const sequence=++this.loadSequence;this.loading=true;this.render();
  try{const recipe=id?await this.store.get(id):null;if(sequence!==this.loadSequence)return;this.recipe=recipe;$('ar-recipe').value=id;$('ar-replace').checked=false;
   const clips=recipe?.actionDocument.clips.filter(c=>Object.values(c.tracks).some(k=>k.length))||[];$('ar-clip').replaceChildren(...(clips.length?clips.map(c=>new Option(c.name+' · '+c.duration.toFixed(2)+' s',c.id)):[new Option('No keyed actions','')]));$('ar-action-name').value=clips.length?(clips[0].name+' · reused').slice(0,120):'';
  }finally{if(sequence===this.loadSequence){this.loading=false;this.render();}}
 }
 async saveCurrent(){
  this.lab.checkReplacement();check(this.lab.document?.joints.length,'Place or predict a skeleton before saving a reusable rig.');
  const recipe=createRigRecipe(this.lab.document,{name:$('ar-name').value.trim()||this.lab.document.title.slice(0,120),bounds:boundsOf(this.lab.base)});
  await this.store.save(recipe);await this.refresh(recipe.id);this.report('Saved “'+recipe.name+'” with its skeleton and actions. Save the character draft separately to keep its mesh and weights.');return recipe;
 }
 fit(){
  this.lab.checkReplacement();check(this.recipe&&!this.loading,'Choose a saved rig first.');
  const result=fitRigRecipe(this.recipe,this.lab.document,boundsOf(this.lab.base),{replaceRig:$('ar-replace').checked});
  this.lab.change(()=>{this.lab.detachAll();this.lab.document=result.document;this.lab.clipId=result.document.clips[0].id;this.lab.selected=result.document.joints[0].id;this.lab.poses={};this.lab.time=0;this.lab.mode='rig';this.lab.tool='select';this.lab.showWeights=false;});
  $('ar-replace').checked=false;this.report(result.message);this.lab.notify(result.message);return result;
 }
 reuse(){
  this.lab.checkReplacement();check(this.recipe&&!this.loading,'Choose a saved rig first.');
  const result=reuseRigAction(this.recipe,this.lab.document,$('ar-clip').value,{speed:number('ar-speed'),travelScale:number('ar-travel'),name:$('ar-action-name').value.trim()||undefined});
  this.lab.change(()=>{this.lab.document.clips.push(result.clip);this.lab.clipId=result.clip.id;this.lab.time=0;this.lab.mode='pose';this.lab.poses=sampleClip(result.clip,0);this.lab.tool='select';});this.lab.seek(0);this.report(result.message);this.lab.notify(result.message);return result;
 }
 render(){
  if(!$('ar-recipe'))return;const lab=this.lab,doc=lab.document,busy=this.loading||lab.busy||lab.hasPending||!!lab.skeletonCandidate,available=!!doc&&lab.active!==false;
  if(doc!==this.lastDocument){if(this.lastDocument&&this.lastDocument.joints!==doc?.joints)$('ar-replace').checked=false;this.lastDocument=doc;}
  const recipe=this.recipe;if(this.compatibilityDocument!==doc||this.compatibilityRecipe!==recipe){this.compatibilityDocument=doc;this.compatibilityRecipe=recipe;this.compatibility=recipe&&doc?rigCompatibility(recipe,doc):null;}const compatibility=this.compatibility;
  $('ar-summary').textContent=recipe?`${recipe.actionDocument.joints.length} joints · ${recipe.actionDocument.clips.filter(c=>Object.values(c.tracks).some(k=>k.length)).length} keyed actions · weights are calculated for each character.`:'';
  $('ar-compatibility').textContent=compatibility?.message||'Save or choose a recipe to see compatibility.';
  for(const el of document.querySelectorAll('.action-rig-library button,.action-rig-library select,.action-rig-library input'))el.disabled=busy||!available;
  $('ar-save').disabled=busy||!doc?.joints.length;$('ar-export').disabled=$('ar-remove').disabled=busy||!recipe;
  $('ar-replace').closest('label').hidden=!doc?.joints.length;
  $('ar-fit').disabled=busy||!available||!recipe||!!doc?.joints.length&&!$('ar-replace').checked;
  $('ar-reuse').disabled=busy||!available||!compatibility?.compatible||!$('ar-clip').value;
 }
}
