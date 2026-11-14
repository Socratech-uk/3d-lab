import {BODY_ROLES,bodyJointLabel,bodyMapReport,bodySignature,suggestBodySetup} from './action-anatomy.mjs';
const $=id=>document.getElementById(id);
export const bodyMapperMarkup=`<section data-action-panel="body" hidden class="action-body-map">
 <span class="eyebrow">MESH → BODY → MOTION</span><h3>Give the joints a job.</h3>
 <p class="helper">Automatically label people and four-legged animals. Review the suggested pelvis, spine, head, limbs, paws and tail on your model. Extra joints stay in the full rig and follow their parents.</p>
 <label class="field">Body type<select id="a-body-kind"><option value="humanoid">Person · two legs</option><option value="quadruped">Animal · four legs</option></select></label>
 <label class="field">Model faces<select id="a-body-facing"><option value="+Z">+Z · front</option><option value="-Z">−Z · back</option><option value="+X">+X · right</option><option value="-X">−X · left</option></select></label>
 <p class="helper">Use a Y-up rest pose. A four-legged animal’s head may sit below its pelvis. The arrow shows the chosen forward direction. Left/right always mean the character’s own sides.</p>
 <button type="button" id="a-body-detect">Auto-detect body & facing</button><button type="button" id="a-body-suggest">Suggest body joints</button><p id="a-body-note" class="helper" role="status"></p>
 <div class="action-body-legend"><span>Blue · left</span><span>Coral · right</span><span>Teal · centre</span><span>Grey · extra</span></div>
 <p id="a-body-selection" class="helper" role="status"></p><p class="helper">Choose a role to highlight it. Pick a point on the model, then use “Assign selected”. Optional roles may stay empty.</p>
 <label class="consent"><input id="a-body-missing-only" type="checkbox">Show missing required roles only</label>
 <div id="a-body-roles" class="action-body-roles"></div>
 <div id="a-body-report" class="action-body-report" role="status"></div>
 <label class="consent"><input id="a-body-reviewed" type="checkbox">I checked the mapped body joints and forward direction on the model.</label>
 <button type="button" id="a-body-use" class="primary">Use body map</button><button type="button" id="a-body-bend">Preview a local bend test</button><p class="helper">After applying and binding, test the elbows and knees without loading an AI model. This adds a separate diagnostic action and leaves existing actions intact.</p>
 <p class="helper">This preserves joint names, positions, weights and existing actions. Save actions to keep the map. It improves the model’s input; a good gait still needs review.</p>
</section>`;

export class ActionBodyMapper{
 constructor({getDocument,getSelected,onSelect,onApply,onRefresh,notify}){
  Object.assign(this,{getDocument,getSelected,onSelect,onApply,onRefresh,notify,map:null,sources:{},sourceKey:'',note:'',lastRows:''});
  $('a-body-kind').onchange=()=>this.suggest({keepFacing:false});$('a-body-facing').onchange=()=>this.suggest();$('a-body-suggest').onclick=()=>this.suggest();$('a-body-detect').onclick=()=>this.suggest({detect:true});
  $('a-body-reviewed').onchange=()=>this.render();$('a-body-missing-only').onchange=()=>this.render(true);
  $('a-body-use').onclick=()=>{try{const doc=this.getDocument(),report=bodyMapReport(doc.joints,this.map,{requireReview:false});if(report.issues.length)throw Error(report.issues[0]);if(!$('a-body-reviewed').checked)throw Error('Check the mapped joints and facing first.');const map={...this.map,signature:bodySignature(doc.joints,this.map)};this.onApply(map);this.map=structuredClone(map);this.note='Body map saved in the working draft. Extra joints stay in your detailed rig.';this.render(true);}catch(e){this.notify(e.message,true);}};
 }
 reset(kind){const doc=this.getDocument();if(!doc?.joints.length){this.map=null;this.sourceKey='';this.savedKey='';return;}this.sourceKey=doc.joints.map(j=>j.id).join('|');const saved=doc.bodyMap;this.savedKey=JSON.stringify(saved||null);
  if(saved){this.map=structuredClone(saved);this.sources={};this.note='Saved body map. Auto-detect can propose fresh labels; review before replacing this map. Rest-pose or hierarchy changes require another review.';}
  else{const result=suggestBodySetup(doc.joints,{kind});this.map=result.map;this.sources=result.sources;this.note=result.note;}
  $('a-body-kind').value=this.map.kind;$('a-body-facing').value=this.map.facing;$('a-body-reviewed').checked=!!saved&&saved.signature===bodySignature(doc.joints,saved);this.lastRows='';this.lastReviewState=bodySignature(doc.joints,this.map);
 }
 suggest({detect=false,keepFacing=true}={}){const doc=this.getDocument();if(!doc?.joints.length)return;const result=suggestBodySetup(doc.joints,{kind:detect?null:$('a-body-kind').value,facing:detect||!keepFacing?null:$('a-body-facing').value});this.map=result.map;this.sources=result.sources;this.note=result.note;$('a-body-kind').value=this.map.kind;$('a-body-facing').value=this.map.facing;$('a-body-reviewed').checked=false;this.render(true);this.onRefresh();}
 assign(role,id){if(id){for(const [other,used]of Object.entries(this.map.roles))if(used===id&&other!==role){delete this.map.roles[other];delete this.sources[other];}this.map.roles[role]=id;this.sources[role]='your selection';}else delete this.map.roles[role];delete this.map.signature;this.note='Body map changed. Check the highlights, then Use body map to apply these selections.';$('a-body-reviewed').checked=false;this.render(true);if(id)this.onSelect(id);this.onRefresh();}
 render(force=false){const doc=this.getDocument();if(!doc?.joints.length){this.map=null;return;}if(this.sourceKey!==doc.joints.map(j=>j.id).join('|')||this.savedKey!==JSON.stringify(doc.bodyMap||null)||!this.map)this.reset();
  const ids=new Set(doc.joints.map(j=>j.id));for(const [r,id]of Object.entries(this.map.roles))if(!ids.has(id))delete this.map.roles[r];
  const current=bodySignature(doc.joints,this.map);if(this.lastReviewState&&this.lastReviewState!==current)$('a-body-reviewed').checked=false;this.lastReviewState=current;
  const selected=doc.joints.find(j=>j.id===this.getSelected()),report=bodyMapReport(doc.joints,this.map,{requireReview:false});
  $('a-body-selection').textContent=selected?'Selected point: '+bodyJointLabel(selected,this.map):'Select a joint point in the viewport.';$('a-body-note').textContent=this.note;
  const signature=JSON.stringify([this.map,this.sources,doc.joints.map(j=>[j.id,j.name]),selected?.id,$('a-body-missing-only').checked]);
  if(force||signature!==this.lastRows){this.lastRows=signature;const defs=BODY_ROLES[this.map.kind].filter(r=>!$('a-body-missing-only').checked||r.required&&!this.map.roles[r.name]);
   $('a-body-roles').replaceChildren(...defs.map(r=>{const row=document.createElement('div');row.className='action-body-role';row.dataset.role=r.name;const label=document.createElement('label'),title=document.createElement('span'),select=document.createElement('select');title.textContent=r.label+(r.required?'':' · optional');select.setAttribute('aria-label',r.label+' joint');select.append(new Option(r.required?'Choose joint…':'Not mapped',''),...doc.joints.map(j=>new Option(bodyJointLabel(j,this.map),j.id)));select.value=this.map.roles[r.name]||'';select.onchange=()=>this.assign(r.name,select.value);label.append(title,select);const buttons=document.createElement('div'),show=document.createElement('button'),assign=document.createElement('button');show.type=assign.type='button';show.textContent='Show';show.setAttribute('aria-label','Show '+r.label);show.disabled=!this.map.roles[r.name];show.onclick=()=>this.onSelect(this.map.roles[r.name]);assign.textContent='Assign selected';assign.setAttribute('aria-label','Assign selected joint to '+r.label);assign.disabled=!selected;assign.onclick=()=>this.assign(r.name,this.getSelected());buttons.append(show,assign);const source=document.createElement('small');source.textContent=this.sources[r.name]|| (this.map.roles[r.name]?'mapped':'needs selection');row.dataset.side=r.name.startsWith('Left')?'left':r.name.startsWith('Right')?'right':'centre';row.append(label,buttons,source);return row;}));
  }
  for(const row of $('a-body-roles').children){const buttons=row.querySelectorAll('button');buttons[0].disabled=!this.map.roles[row.dataset.role];buttons[1].disabled=!selected;}
  const summary=document.createElement('strong');summary.textContent=report.mapped+' motion joints · '+report.helpers+' extra joints kept';const notes=[...report.issues,...report.warnings];$('a-body-report').replaceChildren(summary,...notes.map(t=>{const p=document.createElement('p');p.textContent=t;return p;}));$('a-body-use').disabled=report.issues.length>0||!$('a-body-reviewed').checked;
 }
}
