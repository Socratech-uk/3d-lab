import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {check} from './core.mjs';
import {uid,normalizeActionDocument} from './action-document.mjs';
import {defaultGameClip,normalizeGameClip,EVENT_NAMES,FOOT_ROLES} from './action-game-data.mjs';
import {reviewGameClip,suggestContacts,transferMap,transferGameAction,mappedFeet} from './action-game-analysis.mjs';
import {containDialogFocus} from './dialog-focus.mjs';
const $=id=>document.getElementById(id);
const num=id=>{check($(id).value.trim(),'Enter a value.');const n=Number($(id).value);check(Number.isFinite(n),'Enter a finite number.');return n;};
const field=(id,label)=>`<label class="field">${label}<input id="${id}" type="number" min="0" step="0.01"></label>`;
const markup=`<section class="action-game-prepare"><span class="eyebrow">PREPARE THE SELECTED ACTION</span><h3 id="ag-title">Action</h3>
<p class="helper">Choose an action on the timeline. Mark contacts, set its playback behaviour and check it before assigning a movement slot.</p>
<label class="field">Playback<select id="ag-playback"><option value="loop">Loop · repeat a complete cycle</option><option value="once">One-shot · play once</option></select></label>
<label class="consent"><input id="ag-interrupt" type="checkbox" checked>Allow another action to interrupt</label>
<label class="field">Root travel<select id="ag-root"><option value="in-place">In place · game controls travel</option><option value="authored">Authored travel · special-action source</option></select></label>
<p class="helper">Movement slots always use in-place copies. Authored travel is retained in the normal action export for a receiving special-action controller.</p>
<label class="field">Distance per complete cycle · metres<input id="ag-stride" type="number" min="0.01" max="100" step="0.01" placeholder="Optional · calibrate walk/run"></label>
<div class="game-row"><button id="ag-settings">Keep action settings</button><button id="ag-measure">Measure root travel</button></div>
<p id="ag-measurement" class="helper" role="status"></p>
<details open><summary>Foot contacts</summary><p class="helper">A contact window is when a foot should stay planted. Coloured bands appear below the timeline and rings follow the marked feet. Suggestions use foot height and vertical speed; inspect them before applying.</p>
<label class="field">Foot<select id="ag-foot"></select></label><div class="game-pair">${field('ag-from','Planted from · s')}${field('ag-to','Lift off · s')}</div>
<div class="game-row"><button id="ag-contact-from">Start at playhead</button><button id="ag-contact-to">End at playhead</button></div>
<div class="game-row"><button id="ag-contact-add">Add contact</button><button id="ag-suggest">Suggest contacts</button></div>
<p id="ag-proposal" class="helper" role="status"></p><div class="game-row"><button id="ag-apply-contacts" hidden>Apply suggestions</button><button id="ag-discard-contacts" hidden>Discard suggestions</button></div>
<div id="ag-contacts" class="game-marker-list"></div></details>
<details><summary>Action events</summary><p class="helper">Named timing markers for gameplay presentation. Foundry binds recordings to these exact names. Kestrel 0.36+ plays them during the published action.</p>
<label class="field">Event<select id="ag-event-preset"></select></label><label class="field">Event name<input id="ag-event-name" maxlength="64" value="left-foot-down"></label>
${field('ag-event-time','Time · seconds')}<div class="game-row"><button id="ag-event-now">Use playhead</button><button id="ag-event-add">Add event</button></div><div id="ag-events" class="game-marker-list"></div></details>
<details open><summary>Review & reuse</summary><button id="ag-review">Check this action</button><div id="ag-review-report" class="action-body-report" role="status">Check loops, limb movement and marked contacts.</div>
<button id="ag-transfer">Transfer action from another rig…</button><p class="helper">Import an Action Lab recipe or movement recipe, review the body-role mapping, then add a new editable action. Meshes, weights and existing actions stay in place.</p></details></section>`;

export class ActionGameEditor {
 constructor(lab){this.lab=lab;this.proposal=null;this.report='';this.clipId=null;
  document.querySelector('[data-action-panel=game]').insertAdjacentHTML('beforeend',markup);
  const bands=document.createElement('div');bands.id='ag-timeline';bands.className='game-marker-timeline';bands.setAttribute('aria-label','Foot contacts and action events');document.querySelector('.action-ruler').after(bands);
  const status=document.createElement('p');status.id='ag-active';status.className='helper';bands.after(status);
  $('ag-foot').replaceChildren(...FOOT_ROLES.map(r=>new Option(r.replace(/([A-Z])/g,' $1').trim(),r)));
  $('ag-event-preset').replaceChildren(...EVENT_NAMES.map(v=>new Option(v,v)));
  $('ag-event-preset').onchange=()=>{if($('ag-event-preset').value!=='custom')$('ag-event-name').value=$('ag-event-preset').value;};
  const act=(id,fn)=>$(id).onclick=()=>lab.run(()=>{lab.checkReplacement();return fn();});
  act('ag-settings',()=>this.edit(game=>{game.interruptible=$('ag-interrupt').checked;game.rootMotion=$('ag-root').value;game.strideLength=$('ag-stride').value.trim()?num('ag-stride'):null;lab.clip().loop=$('ag-playback').value==='loop';}));
  act('ag-measure',()=>{const value=this.review();check(value.rootDistance>.01,'This clip has little net root travel. Enter a measured distance per complete stride instead.');$('ag-stride').value=value.rootDistance.toFixed(3);$('ag-measurement').textContent=`${value.rootDistance.toFixed(2)} m over ${value.duration.toFixed(2)} s ≈ ${value.suggestedSpeed.toFixed(2)} m/s. Use one straight, complete cycle; Keep action settings to save this value.`;});
  act('ag-contact-from',()=>{$('ag-from').value=lab.time.toFixed(3);});act('ag-contact-to',()=>{$('ag-to').value=lab.time.toFixed(3);});
  act('ag-contact-add',()=>this.edit(game=>game.contacts.push({id:uid('contact'),role:$('ag-foot').value,from:num('ag-from'),to:num('ag-to')})));
  act('ag-suggest',()=>{lab.stop();this.proposal={clip:lab.clip(),contacts:suggestContacts(lab.document,lab.clip())};this.render();lab.renderHelpers();});
  act('ag-apply-contacts',()=>{check(this.proposal?.clip===lab.clip(),'Suggest contacts for the current action again.');const contacts=this.proposal.contacts;this.proposal=null;this.edit(game=>{game.contacts=contacts;});});
  act('ag-discard-contacts',()=>{this.proposal=null;this.render();lab.renderHelpers();});
  act('ag-event-now',()=>{$('ag-event-time').value=lab.time.toFixed(3);});
  act('ag-event-add',()=>this.edit(game=>game.events.push({id:uid('event'),name:$('ag-event-name').value.trim(),time:num('ag-event-time')})));
  act('ag-review',()=>{const result=this.review();this.report=result.messages.length?result.messages.join(' '):'No obvious seam or limb-motion issues found. Preview feet and bends before publishing.';$('ag-review-report').textContent=this.report;});
  act('ag-transfer',()=>this.openTransfer());
 }
 edit(fn){this.lab.checkReplacement();this.proposal=null;this.lab.change(()=>{const clip=this.lab.clip(),game=structuredClone(clip.game||defaultGameClip());fn(game);clip.game=normalizeGameClip(game,clip.duration);});}
 review(){check(this.lab.document.joints.length,'Add a rig first.');const p=this.lab.document.movement,bounds=new THREE.Box3().setFromObject(this.lab.base);return reviewGameClip(this.lab.document,this.lab.clip(),{height:p?.height||1.8,meshHeight:bounds.max.y-bounds.min.y});}
 contacts(){return this.proposal?.clip===this.lab.clip()?this.proposal.contacts:this.lab.clip().game?.contacts||[];}
 jump(time){this.lab.stop();this.lab.setMode('pose');this.lab.seek(time);}
 render(){const clip=this.lab.clip(),game=clip.game||defaultGameClip();if(this.proposal?.clip!==clip)this.proposal=null;
  if(this.clipId!==clip.id){this.clipId=clip.id;this.report='Check loops, limb movement and marked contacts.';$('ag-measurement').textContent='';$('ag-from').value=0;$('ag-to').value=Math.min(.3,clip.duration).toFixed(2);$('ag-event-time').value=0;}
  $('ag-title').textContent=clip.name;$('ag-playback').value=clip.loop?'loop':'once';$('ag-interrupt').checked=game.interruptible;$('ag-root').value=game.rootMotion;$('ag-stride').value=game.strideLength??'';$('ag-review-report').textContent=this.report;
  $('ag-proposal').textContent=this.proposal?`${this.proposal.contacts.length} suggested contacts shown as dashed bands. Review, then apply or discard.`:'';$('ag-apply-contacts').hidden=$('ag-discard-contacts').hidden=!this.proposal;
  for(const [target,list,kind]of [['ag-contacts',game.contacts,'contacts'],['ag-events',game.events,'events']]){
   $(target).replaceChildren(...list.map(item=>{const row=document.createElement('div'),show=document.createElement('button'),remove=document.createElement('button');show.textContent=kind==='contacts'?`${item.role} · ${item.from.toFixed(2)}–${item.to.toFixed(2)} s`:`${item.name} · ${item.time.toFixed(2)} s`;show.onclick=()=>this.lab.run(()=>this.jump(item.time??item.from));remove.textContent='×';remove.setAttribute('aria-label','Remove '+show.textContent);remove.onclick=()=>this.lab.run(()=>this.edit(g=>{g[kind]=g[kind].filter(c=>c.id!==item.id);}));row.append(show,remove);return row;}));
  }
  this.renderBands();this.renderTime();
 }
 renderBands(){const clip=this.lab.clip(),container=$('ag-timeline');container.replaceChildren();
  const contacts=this.contacts(),roles=FOOT_ROLES.filter(role=>contacts.some(c=>c.role===role));
  for(const role of [...roles,'Events']){const row=document.createElement('div'),label=document.createElement('span'),track=document.createElement('div');row.className='game-marker-lane';label.textContent=role==='Events'?'Events':role.replace('Left','L ').replace('Right','R ');track.className='game-marker-track';row.append(label,track);container.append(row);
   for(const marker of role==='Events'?(clip.game?.events||[]):contacts.filter(c=>c.role===role)){
    const b=document.createElement('button');b.type='button';b.className=role==='Events'?'game-event-tick':'game-contact-band';b.classList.toggle('suggestion',!!this.proposal&&role!=='Events');b.dataset.side=role.startsWith('Left')?'left':'right';b.style.left=((marker.time??marker.from)/clip.duration*100)+'%';if(role!=='Events')b.style.width=((marker.to-marker.from)/clip.duration*100)+'%';b.textContent=role==='Events'?'◆':'';b.title=role==='Events'?`${marker.name} · ${marker.time.toFixed(2)} s`:`${role} · ${marker.from.toFixed(2)}–${marker.to.toFixed(2)} s`;b.setAttribute('aria-label',b.title);b.onclick=()=>this.lab.run(()=>this.jump(marker.time??marker.from));track.append(b);
   }
   const playhead=document.createElement('i');playhead.className='game-marker-playhead';track.append(playhead);
  }
 }
 renderTime(){if(!this.lab.document)return;const time=this.lab.time,clip=this.lab.clip();document.querySelectorAll('.game-marker-playhead').forEach(n=>n.style.left=(time/clip.duration*100)+'%');
  const active=this.contacts().filter(c=>time>=c.from&&time<c.to).map(c=>c.role),events=(clip.game?.events||[]).filter(e=>Math.abs(e.time-time)<=.5/clip.fps).map(e=>e.name);$('ag-active').textContent=[active.length?'Planted: '+active.join(', '):'',events.length?'Event: '+events.join(', '):''].filter(Boolean).join(' · ');
 }
 addHelpers(group,worldToModel,size){if(document.querySelector('[data-action-panel=game]').hidden)return;for(const f of mappedFeet(this.lab.document)){const planted=this.contacts().some(c=>c.role===f.role&&this.lab.time>=c.from&&this.lab.time<c.to);if(!planted)continue;const ring=new THREE.Mesh(new THREE.TorusGeometry(size*.023,size*.003,6,24),new THREE.MeshBasicMaterial({color:f.role.startsWith('Left')?0x73b8ff:0xff947e,depthTest:false,depthWrite:false}));ring.rotation.x=Math.PI/2;ring.position.copy(this.lab.rig.bones.get(f.id).getWorldPosition(new THREE.Vector3()).applyMatrix4(worldToModel));ring.renderOrder=115;group.add(ring);}}
 openTransfer(){
  const target=this.lab.document;this.lab.stop();const dialog=document.createElement('dialog');dialog.className='action-transfer-dialog';dialog.setAttribute('aria-label','Transfer an action between rigs');
  dialog.innerHTML=`<h2>Reuse an action.</h2><p>Choose another character’s Action Lab recipe or movement recipe. Both rigs need reviewed body maps of the same type.</p><label class="field">Source recipe<input id="ag-transfer-file" type="file" accept=".json"></label><label class="field">Source action<select id="ag-transfer-clip" disabled></select></label><div id="ag-transfer-map" class="game-transfer-map"></div><p id="ag-transfer-message" role="status"></p><label class="consent"><input id="ag-transfer-review" type="checkbox" disabled>I have checked the body-role mapping.</label><div class="game-row"><button id="ag-transfer-add" disabled>Add transferred action</button><button id="ag-transfer-close">Cancel</button></div>`;
  document.body.append(dialog);const release=containDialogFocus(dialog),close=()=>{release();dialog.close();dialog.remove();$('ag-transfer').focus();};dialog.oncancel=e=>{e.preventDefault();close();};$('ag-transfer-close').onclick=close;dialog.showModal();let source=null;
  const report=message=>{$('ag-transfer-message').textContent=message;};
  $('ag-transfer-file').onchange=async()=>{source=null;$('ag-transfer-add').disabled=true;$('ag-transfer-review').checked=false;$('ag-transfer-review').disabled=true;$('ag-transfer-clip').disabled=true;$('ag-transfer-map').replaceChildren();try{const file=$('ag-transfer-file').files[0];if(!file)return;check(file.size<=24*1024**2,'Use a recipe up to 24 MiB.');const value=JSON.parse(await file.text());if(!dialog.isConnected)return;const doc=normalizeActionDocument(value.format==='capp.movement-pack'?value.actionDocument:value),map=transferMap(doc,target);source=doc;const clips=doc.clips.filter(c=>Object.values(c.tracks).some(k=>k.length));check(clips.length,'This source has no keyed actions.');$('ag-transfer-clip').replaceChildren(...clips.map(c=>new Option(c.name,c.id)));$('ag-transfer-clip').disabled=false;
   for(const row of map.rows){const p=document.createElement('p');p.textContent=`${row.role}: ${doc.joints.find(j=>j.id===row.source).name} → ${target.joints.find(j=>j.id===row.target).name}`;$('ag-transfer-map').append(p);}report(`${doc.title} → ${target.title}. ${map.rows.length} body roles matched. Extra target joints follow their parents. Review contacts and recalibrate stride after transfer.`);$('ag-transfer-review').disabled=false;
  }catch(error){source=null;report(error.message);}};
  $('ag-transfer-review').onchange=()=>{$('ag-transfer-add').disabled=!source||!$('ag-transfer-review').checked;};
  $('ag-transfer-add').onclick=()=>{try{check(this.lab.document===target,'The target changed. Close this dialog and try again.');check(source&&$('ag-transfer-review').checked,'Review the mapping first.');const result=transferGameAction(source,target,$('ag-transfer-clip').value);this.lab.change(()=>{this.lab.document.clips.push(result.clip);this.lab.clipId=result.clip.id;this.lab.time=0;this.lab.poses={};this.lab.mode='pose';});close();this.lab.seek(0);this.lab.notify('Transferred action added. Preview bends and feet, recalibrate the stride, then Save actions. Undo restores the previous scene.');}catch(error){report(error.message);}};
 }
}
