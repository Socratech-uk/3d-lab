import {touchUpTexture} from './texture-painter.mjs';
import {AssetPreviews} from './asset-previews.mjs';
import {saveAsset,identityChoice} from './asset-lifecycle.mjs';
import {ActionFlowEditor} from './action-flow-editor.mjs';
import {createActionFlowAdapters} from './action-flow-adapters.mjs';
import {ACTION_MODELS} from './action-engine.mjs';
import {cloneActionDocument} from './action-document.mjs';
import { MODELS, modelById } from './models.mjs';
import { VERSION, LIMITS, prepareImage, inspectGlb, metadata, filterAssets, check, key } from './core.mjs';
import { ThreeLabBridge } from './bridge.mjs';
import {DiskModelLibrary} from './disk-library.mjs';
import {DiskAuthoringStorage,DiskRigRecipeStore} from './disk-authoring.mjs';
import {mountStoragePanel} from './storage-panel.mjs';
import {PromptLibrary} from './action-prompts.mjs';
import { ModelWorkshop } from './workshop.mjs';
import { ModelViewer } from './viewer.mjs';
import { Builder } from './builder.mjs';
import { ActionLab } from './action-lab.mjs';
import { ActionAssetPicker } from './action-assets.mjs';
import { prepareActionAsset, confirmActionReplacement } from './action-handoff.mjs';
import { disposeComponent } from './builder-objects.mjs';
import { ShapeLab } from './shape-lab.mjs';
import { initViewportWorkspace } from './viewport-workspace.mjs';
import { createProjectWorkspace } from './project-lab.mjs';

const $ = id => document.getElementById(id);
let browserCache;try{browserCache=window.localStorage;}catch{}
const library = new DiskModelLibrary({connectionStorage:browserCache}), bridge = new ThreeLabBridge();
const authoringStorage=new DiskAuthoringStorage({library,cache:browserCache});
const rigStore=new DiskRigRecipeStore(authoringStorage);
let projectWorkspace=null;
const workshop = new ModelWorkshop(bridge, library, renderOperation);
let workQueue=Promise.resolve(),workWrites=0,syncActionWork=()=>{};
let actionFlow = null, actionLab = null, actionAssetPicker = null, builder = null, shapeLab = null, previewRestore = null, viewportWorkspace = null, assetHandoffBusy = false;
const stagePanel = document.querySelector('.stage-panel'), createStageAnchor = document.createComment('create-stage'); stagePanel.before(createStageAnchor);
let viewer = null, source = null, sourceUrl = '', rows = [], active = null, page = 0, view = 'create', loadSerial = 0, gridSerial = 0, contextId = '', contextOrigin = null, metadataDirty = false, imageBusy = false;
const pageSize = 24, thumbnailUrls = new Set(), gridPreviews=new AssetPreviews(library);
const stages = {
  materials: ['Texture your model.', 'Materials and source-image baking are available in Builder.', 'Select parts, adjust material or glass settings, upload surface maps, or bake colours from retained reference views. Textures and supported glass properties are embedded in saved GLBs. Hidden surfaces are not generated.'],
  projects: ['One project. Every asset.', 'Use Project Assets to connect your Kestrel workspace.', 'Assign model, movement and sound revisions to stable game asset IDs.']
};
function notify(message, error = false) { $('notice-text').textContent = String(message); $('notice').classList.toggle('error', error); $('notice').hidden = false; }
function failure(error) { notify(error?.message || String(error), true); }
function guard(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(failure); }
function bytesLabel(bytes) { return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`; }
function safeFilename(name) { return String(name || '3d-model').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/,'').slice(0,120) || '3d-model'; }
function download(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url),30000); }
const extraViews = {}, viewUrls = {};
function settings() { const model=$('model').value;return { model, device: $('device').value, resolution: Number($('resolution').value), seed: Number($('seed').value), steps: Number($('steps').value),...(model.startsWith('hunyuan3d-')?{guidanceScale:Number($('guidance-scale').value),memoryMode:$('memory-mode').value,numChunks:Number($('num-chunks').value),imagePadding:Number($('image-padding').value)}:{}) }; }
function updateModel() {
  const model = modelById($('model').value); $('accept-license').checked = false; $('model').title = `${model.name} — ${model.minimum}`;
  $('model-description').textContent = model.description;
  $('model-requirements').textContent = `Minimum: ${model.minimum}. Memory use varies with detail and other loaded models.`;
  $('model-setup').hidden = !model.setupReason; $('model-setup').textContent = model.setupReason || '';
  $('model-source').href = model.sourceUrl;
  $('model-license').href = model.licenseUrl; $('model-license').textContent = model.name + ' licence (' + model.license + ')';
  $('license-notice').hidden = !model.licenseNotice; $('license-notice').textContent = model.licenseNotice || '';
  $('choose-multiview').hidden = model.multiview; $('multiview').hidden = !model.multiview; $('diffusion-settings').hidden = model.id === 'triposr';
  $('hunyuan-settings').hidden=!model.id.startsWith('hunyuan3d-');
  const detail=Number($('resolution').value);$('resolution').replaceChildren(...model.resolutions.map(n=>new Option(n+' · '+({128:'Draft',256:'Standard',384:'Fine',512:'High'}[n]||'Detail'),String(n))));$('resolution').value=String(model.resolutions.includes(detail)?detail:256);
  const old = $('device').value; $('device').replaceChildren(...model.devices.map(id => new Option({auto:'Automatic',cuda:'NVIDIA GPU',cpu:'CPU'}[id],id))); $('device').value = model.devices.includes(old) ? old : 'auto';
  $('device-help').textContent = model.id === 'triposr' ? 'Automatic uses an available device. CPU generation can take much longer.' : 'Automatic uses NVIDIA CUDA for this model. Requirements are guidance; models are never hidden because of available memory.';
  renderOperation();
}
function renderViews() {
  for (const key of ['left','right','back']) { $('view-'+key+'-name').textContent=extraViews[key]?.name||'No image'; if(viewUrls[key]) URL.revokeObjectURL(viewUrls[key]); const img=$('view-'+key+'-preview'); img.hidden=!extraViews[key]; if(extraViews[key]) {viewUrls[key]=URL.createObjectURL(extraViews[key].blob);img.src=viewUrls[key];}else{delete viewUrls[key];img.removeAttribute('src');} }
}
$('model').replaceChildren(...MODELS.map(m => new Option(`${m.name} — ${m.minimum}`,m.id)));
for (const key of ['left','right','back']) {
  const row = document.createElement('div'); row.className = 'view-input';
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true; input.id = 'view-'+key+'-input';
  const name = document.createElement('span'); name.id = 'view-'+key+'-name'; name.textContent = 'No image';
  const choose = document.createElement('button'); choose.textContent = key[0].toUpperCase()+key.slice(1); choose.title = 'Choose the '+key+' view of the same object'; choose.id = 'view-'+key+'-choose'; choose.onclick = () => input.click();
  const clear = document.createElement('button'); clear.textContent = '×'; clear.title = 'Remove '+key+' reference'; clear.id = 'view-'+key+'-clear'; clear.onclick = () => { delete extraViews[key]; renderViews(); };
  async function accept(file) { check(!workshop.busy && !imageBusy,'Wait for the current operation to finish.'); if (!file) return; imageBusy=true;renderOperation();try {extraViews[key]=await prepareImage(file);renderViews();}finally{imageBusy=false;renderOperation();} }
  input.onchange = guard(async () => {const file=input.files[0];input.value='';await accept(file);});
  row.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
  row.ondrop = e => { e.preventDefault();e.stopPropagation();const files=Array.from(e.dataTransfer?.files || []);guard(async()=>{check(files.length===1,'Drop one view at a time.');await accept(files[0]);})(); };
  const preview=document.createElement('img');preview.id='view-'+key+'-preview';preview.alt=key+' reference';preview.hidden=true;row.append(preview,choose,name,clear,input);$('view-inputs').append(row);
}
$('model').addEventListener('change',updateModel);
$('choose-multiview').addEventListener('click',()=>{if(workshop.busy||imageBusy)return;$('model').value='hunyuan3d-2mv';updateModel();$('multiview').scrollIntoView({block:'nearest'});});
function consentToLeave() {
  if(builder?.busy || shapeLab?.busy || actionLab?.busy || actionLab?.engine.busy) { notify('Wait for the current edit to finish.'); return false; }
  if((builder?.dirty || builder?.hasPending) && !window.confirm('This Builder session has unsaved edits or an unfinished outline. Discard the session and continue? Save asset to keep it.')) return false;
  if(actionLab?.active && (actionLab.hasPending || actionLab.skeletonCandidate)) { notify(actionLab.skeletonCandidate ? 'Apply or discard the skeleton candidate before switching workspaces.' : 'Finish the current Action Lab gesture, or press Escape before switching workspaces.'); return false; }
  if(shapeLab?.active) {
    if(shapeLab.hasPending) { if(!window.confirm('Cancel the unfinished Shape Lab outline or gesture and switch workspace? Completed shape edits are retained.'))return false;shapeLab.cancelPending(); }
    if(!shapeLab.flushSession() && shapeLab.dirty && !window.confirm('The Shape Lab session could not be stored on this device. Keep it in memory and switch workspace? Save a draft or export before closing the app.'))return false;
  }
  return !metadataDirty || window.confirm('The asset details have unsaved changes. Discard those details and continue?');
}
function showView(next, { force = false, actionRecord, prepared } = {}) {
  if(assetHandoffBusy && !force) { notify('Wait for the asset to finish opening.'); return false; }
  if(next==='actions' && !force) {
    const id=actionLab?.base ? actionLab.record?.asset?.id || null : active?.asset.id || null;
    guard(()=>openActionAsset(id))(); return false;
  }
  if((next==='builder'||next==='shapes'||next==='actions') && workshop.busy) { notify('Wait for model generation or preparation to finish before editing.'); return false; }
  if(next==='builder'&&shapeLab?.active&&!force){shapeLab.run(()=>shapeLab.save(true));return false;}
  if(next==='shapes'&&(!viewer||!shapeLab)){notify('Shape Lab needs a working 3D preview. Restore the preview and try again.');return false;}
  if(next==='actions'&&(!viewer||!actionLab)){notify('Action Lab needs a working 3D preview. Restore the preview and try again.');return false;}
  if(next==='builder'&&active?.files?.actionDocument){notify('Action drafts contain a rig. Open Action Lab to edit them; use the original mesh for geometry edits.');return false;}
  if(next==='builder'&&(!active||!viewer)){notify('Open or import a saved draft, then choose Builder.');return false;}
  if(view===next&&(next==='builder'||next==='shapes'||(next==='actions'&&!prepared)))return true;
  if(!force&&!consentToLeave())return false;
  // Commit the validated Action Lab scene before leaving another editor or
  // changing navigation. A render failure must not force a workspace switch.
  if(next==='actions')actionLab.open(actionRecord===undefined?active:actionRecord,{prepared});
  const leavingBuilder=builder?.active&&next!=='builder',leavingShape=shapeLab?.active&&next!=='shapes',leavingAction=actionLab?.active&&next!=='actions';
  if(leavingAction)actionLab.leave();if(leavingBuilder)builder.leave();if(leavingShape)shapeLab.leave();
  metadataDirty=false;closeContext();view=next;document.body.dataset.view=next;
  $('action-view').hidden=next!=='actions';$('create-view').hidden=next!=='create';$('assets-view').hidden=next!=='assets';$('planned-view').hidden=!stages[next];$('builder-view').hidden=next!=='builder';$('shape-view').hidden=next!=='shapes';
  if(next==='actions'){
    $('action-stage').append(stagePanel);previewRestore=null;actionLab.configureTool();viewer.setNavigationEnabled(true);actionLab.render();$('viewport-title').textContent=actionLab.document.title;$('viewport-kind').textContent='RIG & ANIMATION';$('sample-caption').hidden=true;requestAnimationFrame(()=>viewer.resize());
  }else if(next==='shapes'){
    $('shape-stage').append(stagePanel);previewRestore=null;shapeLab.open();$('viewport-title').textContent=shapeLab.document.title;$('viewport-kind').textContent='EDITABLE SHAPE';$('sample-caption').hidden=true;requestAnimationFrame(()=>viewer.resize());
  }else if(next==='builder'){
    $('builder-stage').append(stagePanel);if(!builder.active){if(previewRestore){const id=active.asset.id;previewRestore.then(()=>{if(view==='builder'&&!builder.active&&active?.asset.id===id)builder.open(active);}).catch(failure);}else builder.open(active);}$('viewport-kind').textContent='EDITABLE COPY';$('sample-caption').hidden=true;requestAnimationFrame(()=>viewer.resize());
  }else{
    createStageAnchor.after(stagePanel);
    if((leavingBuilder||leavingShape||leavingAction)&&!force){
      if(active){const pending=viewer.show(active.bytes);previewRestore=pending;pending.catch(failure).finally(()=>{if(previewRestore===pending)previewRestore=null;});$('viewport-title').textContent=active.asset.title;$('viewport-kind').textContent=assetKind(active.asset);$('mesh-summary').textContent=active.asset.triangles.toLocaleString()+' triangles · '+bytesLabel(active.asset.byteLength);$('sample-caption').hidden=true;}
      else{viewer.sample();$('viewport-title').textContent='A place for your next idea';$('viewport-kind').textContent='SHAPE STUDIO EXAMPLE';$('mesh-summary').textContent='Procedural preview';$('sample-caption').hidden=false;}
    }
  }
  document.querySelectorAll('.primary-nav [data-view]').forEach(b=>{const current=b.dataset.view===next;b.classList.toggle('active',current);if(current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  if(stages[next]){const [title,description,detail]=stages[next];$('planned-title').textContent=title;$('planned-description').textContent=description;$('planned-detail').textContent=detail;}
  if(next==='assets')renderGrid();if(next==='create'){fillInspector();requestAnimationFrame(()=>viewer?.resize());}viewportWorkspace?.refresh();return true;
}
function assetKind(asset){if(asset.origin==='action')return 'ACTION LAB';return asset.origin==='generation'?'GENERATED MESH':asset.origin==='edit'?'BUILDER EDIT':asset.origin==='shape'?'SHAPE LAB':'IMPORTED MESH';}
function checkActionHandoff() {
  check(!actionLab?.flowRunning,'Pause or finish the workflow before opening another character.');
  check(viewer&&actionLab,'Action Lab needs a working 3D preview. Restore the preview and try again.');
  check(!viewer.contextIsLost,'Restore the 3D preview before opening another asset. Your current working scene is retained.');
  check(!workshop.busy&&!builder?.busy&&!shapeLab?.busy&&!actionLab.busy&&!actionLab.engine.busy,'Wait for the current operation, or stop generation before opening another asset.');
}
async function openActionAsset(id, {file=null,reload=false}={}) {
  check(!assetHandoffBusy,'An asset is already opening. Wait for it to finish.');
  checkActionHandoff();
  const same=!reload&&!file&&actionLab.base&&(actionLab.record?.asset?.id||null)===(id||null);
  if(same&&view==='actions')return true;
  if(!same){
    check(!actionLab.skeletonCandidate,'Apply or discard the skeleton candidate before opening another asset.');
    check(!actionLab.hasPending,'Finish the current Action Lab gesture, or press Escape before opening another asset.');
  }
  assetHandoffBusy=true;document.querySelector('main').inert=true;actionLab.stop();const serial=++loadSerial;viewer.cancelPendingLoad();previewRestore=null;
  let prepared=null;
  try{
    let record=same?actionLab.record:null;
    if(file){
      check(file.size>0&&file.size<=LIMITS.glbBytes&&/\.glb$/i.test(file.name),'Choose a self-contained .glb file.');
      const bytes=new Uint8Array(await file.arrayBuffer());inspectGlb(bytes);
      record={asset:{id:null,title:file.name.replace(/\.glb$/i,'').slice(0,160)||'Imported model'},files:{},bytes,dimensions:null};
      prepared=await prepareActionAsset(bytes,record);
    }else if(!same&&id){
      const data=await library.get(id),bytes=new Uint8Array(await data.files.glb.arrayBuffer());
      record={...data,bytes,dimensions:null};prepared=await prepareActionAsset(bytes,record);
    }
    if(serial!==loadSerial)return false;
    if(!consentToLeave())return false;
    if(!same&&!await confirmActionReplacement(actionLab,record?.asset.title||'Practice humanoid'))return false;
    checkActionHandoff();
    if(file){
      const saved=await library.save({bytes:record.bytes,info:{title:record.asset.title},origin:'import'}),data=await library.get(saved.asset.id);
      record={...data,bytes:record.bytes,dimensions:null};
      if(prepared.assignImportedSource)prepared.document.source={id:data.asset.id,sha256:data.asset.sha256};
      await refresh();
    }
    if(serial!==loadSerial)return false;
    const opened=showView('actions',{force:true,actionRecord:record,prepared});
    if(!opened)return false;
    prepared=null;active=record;metadataDirty=false;fillInspector();
    if(record&&!record.files.thumbnail){
      try{const thumb=await viewer.thumbnail();if(thumb&&serial===loadSerial)await library.thumbnail(record.asset.id,thumb);}catch{}
    }
    notify(same?'Resumed your Action Lab session.':`Opened “${actionLab.document.title}” in Action Lab. Save an action draft to keep rig and animation edits.`);
    return true;
  }finally{
    if(prepared?.base)disposeComponent(prepared.base);
    assetHandoffBusy=false;document.querySelector('main').inert=false;
  }
}
async function openShapeAsset(id){
  if(!consentToLeave())return;
  const data=await library.get(id);check(data.files.shapeDocument,'This draft does not contain an editable shape recipe. Open it in Builder.');
  await openAsset(id,{force:true});if(active?.asset.id!==id)return;
  shapeLab.loadDocument({...data.files.shapeDocument,title:data.asset.title},{saved:true});shapeLab.record=data;showView('shapes',{force:true});
  if(data.files.image)await shapeLab.loadReference({...data.asset.source,blob:data.files.image},{restored:true});
}

function renderOperation() {
  const busy = workshop.busy;
  $('operation').hidden = !busy;
  $('operation-title').textContent = workshop.stopping ? 'Stopping…' : workshop.stage;
  $('operation-detail').textContent = workshop.progress?.message || workshop.progress?.stage || 'The local engine is working. You can stop this operation.';
  if (Number.isFinite(workshop.progress?.fraction)) $('operation-progress').value = workshop.progress.fraction; else $('operation-progress').removeAttribute('value');
  $('stop').disabled = workshop.stopping;
  for (const id of ['generate','prepare-model','choose-multiview','model','device','resolution','seed','steps','guidance-scale','memory-mode','num-chunks','image-padding','choose-image','new-title','image-input',...['left','right','back'].flatMap(v => ['view-'+v+'-input','view-'+v+'-choose','view-'+v+'-clear'])]) $(id).disabled = busy || imageBusy;
  const model = modelById($('model').value);
  $('generate').disabled = busy || imageBusy || !source || !!workshop.unsaved || model?.runtimeReady === false;
  $('prepare-model').disabled = busy || imageBusy || model?.runtimeReady === false;
  $('retained').hidden = !workshop.unsaved;
  const invalid=workshop.unsaved?.validationError;
  $('retained-title').textContent=invalid?'Generation finished, but the GLB could not be opened.':'Your completed mesh is retained.';
  $('retained-detail').textContent=invalid?'The original output is kept while this app stays open. Download it for recovery before discarding. '+invalid:'Draft saving failed. Download it now or retry saving.';
  $('retry-save').disabled = busy||!!invalid;
  $('discard-retained').disabled=busy;
  if (workshop.status) renderStatus(workshop.status);
}
function renderStatus(status) {
  const selected = modelById($('model').value), found = status.models?.find(m => m.id === selected.id);
  const parts = [];
  if (selected.setupReason) { $('engine-status').textContent = selected.setupReason; return; }
  if (found) status = { ...status, engineInstalled:found.available, loaded:found.loaded, prepared:found.loaded, modelFilesPresent:found.downloaded, deviceName:found.loaded ? status.deviceName : '' };
  else if (selected.id !== 'triposr') { $('engine-status').textContent = 'Update Local AI to 0.18 and enable TripoSR + advanced shape models, then freshly Compile and Package.'; return; }
  if (status.supported === false) parts.push('3D generation is unavailable on this platform.');
  else if (status.permitted === false) parts.push('Enable 3D authoring in the Local AI package and rebuild.');
  else if (status.engineInstalled === false) parts.push('This model’s engine is not bundled. Enable it in Local AI, then freshly Compile and Package.');
  else if (status.loaded) parts.push('Model loaded');
  else if (status.modelFilesPresent) parts.push('Model files present · load to verify');
  else parts.push('Model preparation required');
  if (status.deviceName) parts.push(String(status.deviceName).slice(0,160));
  if (status.message) parts.push(String(status.message).slice(0,300));
  $('engine-status').textContent = parts.join(' · ');
}
async function selectImage(file) {
  check(!workshop.busy, 'Wait for the current generation to settle.');
  if (!file) return; imageBusy = true; renderOperation();
  try {
    const selected = await prepareImage(file);
    for (const key of Object.keys(extraViews)) delete extraViews[key]; renderViews();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl); source = selected; sourceUrl = URL.createObjectURL(source.blob);
    $('reference-preview').src = sourceUrl; $('reference-preview').hidden = false; $('replace-reference').hidden = false; $('image-empty').hidden = true;
    $('image-details').textContent = `${source.width} × ${source.height} · ${bytesLabel(source.blob.size)} · Reference retained with the draft`;
    if (!$('new-title').value.trim()) $('new-title').value = String(file.name || 'New object').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,160);
  } finally { imageBusy = false; renderOperation(); }
}
async function refresh() {
  rows = await library.list(); $('asset-count').textContent = rows.length;
  const folders = [...new Set(rows.map(r => r.folder).filter(Boolean))].sort((a,b) => a.localeCompare(b)), selected = $('folder-filter').value;
  $('folder-filter').replaceChildren(new Option('All folders',''),...folders.map(f => new Option(f,f))); if (folders.includes(selected)) $('folder-filter').value = selected;
  $('folder-options').replaceChildren(...folders.map(f => new Option(f,f)));
  if (view === 'assets') await renderGrid();
}
async function renderGrid() {
  const serial = ++gridSerial;
  gridPreviews.reset();
  for (const url of thumbnailUrls) URL.revokeObjectURL(url); thumbnailUrls.clear();
  const filtered = filterAssets(rows,{ query: $('search').value, folder: $('folder-filter').value, type: $('type-filter').value });
  const pages = Math.max(1,Math.ceil(filtered.length/pageSize)); page = Math.max(0,Math.min(page,pages-1));
  $('results-count').textContent = `${filtered.length} draft${filtered.length === 1 ? '' : 's'}`;
  $('page-number').textContent = `Page ${page+1} of ${pages}`; $('previous-page').disabled = page === 0; $('next-page').disabled = page >= pages-1;
  $('library-empty').hidden = filtered.length > 0; $('library-empty').querySelector('h2').textContent = rows.length ? 'No drafts match those filters.' : 'Your first object starts with an image.';
  $('library-empty').querySelector('p').textContent = rows.length ? 'Try another name, folder or tag.' : 'Generate a model or import an existing GLB to begin your collection.';
  $('asset-grid').replaceChildren();
  for (const row of filtered.slice(page*pageSize,(page+1)*pageSize)) {
    const card = document.createElement('article'); card.className = 'asset-card' + (active?.asset.id === row.id ? ' active' : ''); card.dataset.asset = row.id; card.tabIndex = 0; card.setAttribute('aria-label',`${row.title}, ${row.origin}, ${row.triangles.toLocaleString()} triangles`);
    const preview = document.createElement('div'); preview.className = 'asset-preview'; preview.textContent = '◇';
    const type = document.createElement('span'); type.className = 'card-tag'; type.textContent = row.origin === 'generation' ? 'GENERATED' : row.origin === 'edit' ? 'EDITED' : row.origin === 'shape' ? 'SHAPE LAB' : row.origin === 'action' ? 'ACTION LAB' : 'IMPORTED';
    const details = document.createElement('div'); details.className = 'asset-card-info';
    const heading = document.createElement('h3'); heading.textContent = row.title; heading.title = row.title;
    const summary = document.createElement('p'); summary.textContent = `${row.folder || 'Unfiled'} · ${row.triangles.toLocaleString()} tris`;
    const menu = document.createElement('button'); menu.className = 'card-menu'; menu.textContent = '⋯'; menu.title = `Actions for ${row.title}`; menu.setAttribute('aria-label',menu.title); menu.setAttribute('aria-haspopup','menu');
    menu.addEventListener('click',e => { e.stopPropagation(); const rect = menu.getBoundingClientRect(); openContext(row.id,rect.right,rect.bottom,menu); });
    const label=document.createElement('label');label.className='zip-flag';const flag=document.createElement('input');flag.type='checkbox';flag.checked=!!row.workPackage;flag.setAttribute('aria-label','Include '+row.title+' in work ZIP');label.append(flag,' Work ZIP');label.addEventListener('dblclick',e=>e.stopPropagation());flag.onchange=guard(async()=>{flag.disabled=true;try{const updated=await library.curate(row.id,row.revision,flag.checked,row.workNotes||'');row.revision=updated.revision;row.workPackage=updated.workPackage;syncAssetMetadata(updated);}catch(error){flag.checked=!flag.checked;throw error;}finally{flag.disabled=false;}});
    details.append(heading,summary,label); card.append(preview,type,details,menu);
    card.addEventListener('dblclick',guard(() => openAsset(row.id))); card.addEventListener('contextmenu',e => { e.preventDefault(); openContext(row.id,e.clientX,e.clientY,card); });
    card.addEventListener('keydown',e => { if (e.target !== card) return; if (e.key === 'Enter') { e.preventDefault(); guard(() => openAsset(row.id))(); } if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const b = card.getBoundingClientRect(); openContext(row.id,b.x+25,b.y+25,card); } });
    $('asset-grid').append(card);
    gridPreviews.watch(card,row.id,preview,row.title);
  }
}
async function openAsset(id, { force = false } = {}) {
  check(!assetHandoffBusy,'Wait for the asset to finish opening.');
  if (!force && !consentToLeave()) return false;
  const serial = ++loadSerial, data = await library.get(id), bytes = new Uint8Array(await data.files.glb.arrayBuffer());
  if (serial !== loadSerial) return false;
  let rendered = null;
  if (viewer) rendered = await viewer.show(bytes);
  if (serial !== loadSerial || (viewer && !rendered)) return false;
  active = { ...data, bytes, dimensions: rendered?.dimensions || null }; metadataDirty = false;
  showView('create',{force:true}); fillInspector();
  $('viewport-title').textContent = data.asset.title; $('viewport-kind').textContent = assetKind(data.asset); $('sample-caption').hidden = true;
  $('mesh-summary').textContent = `${data.asset.triangles.toLocaleString()} triangles · ${bytesLabel(data.asset.byteLength)}`;
  if (viewer && !data.files.thumbnail) {
    const thumb = await viewer.thumbnail();
    if (serial === loadSerial && thumb) library.thumbnail(id,thumb).catch(() => {});
  }
  return true;
}
function fillInspector() {
  $('inspector-empty').hidden = !!active; $('inspector-content').hidden = !active;
  if (!active) return;
  const row = active.asset; $('asset-title').value = row.title; $('asset-folder').value = row.folder; $('asset-tags').value = row.tags.join(', '); $('asset-notes').value = row.notes;
  const values = [['Source',row.origin === 'generation' ? (modelById(row.recipe?.model)?.name || row.recipe?.model || 'TripoSR') : row.origin === 'edit' ? 'Builder edit' : row.origin === 'shape' ? 'Shape Lab' : row.origin === 'action' ? 'Action Lab' : 'Imported GLB'],['Triangles',row.triangles.toLocaleString()],['Vertices',row.vertices.toLocaleString()],['File size',bytesLabel(row.byteLength)],['Created',new Date(row.createdAt).toLocaleDateString()]];
  if (active.dimensions) values.push(['Bounds',active.dimensions.map(n => n.toFixed(2)).join(' × ')]);
  if (row.result?.deviceName) values.push(['Device',row.result.deviceName]);
  if(row.result?.conditioning)values.push(['Model input',row.result.conditioning.processorSize+' px · '+row.result.conditioning.views.map(v=>v.view).join(', ')],['Geometry processing','Marching cubes · no smoothing or reduction']);
  if (row.result?.generationMs) values.push(['Generation',`${(row.result.generationMs/1000).toFixed(1)} s`]);
  if(row.recipe){values.push(['Mesh detail',String(row.recipe.resolution)]);if(row.recipe.steps!==undefined)values.push(['Steps / seed',row.recipe.steps+' / '+row.recipe.seed]);if(row.recipe.model?.startsWith('hunyuan3d-'))values.push(['Guidance',String(row.recipe.guidanceScale??5)],['Model memory',(row.recipe.memoryMode??'gpu')==='cpu-offload'?'CPU offload':'GPU'],['Decode batch',String(row.recipe.numChunks??8000)],['Reference padding',Math.round((row.recipe.imagePadding??.15)*100)+'%']);}
  $('asset-stats').replaceChildren(...values.flatMap(([label,value]) => { const dt = document.createElement('dt'),dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; return [dt,dd]; }));
  $('copy-model-path').disabled=!active.modelPath;
  $('copy-model-path').title=active.modelPath||'Connect asset storage and reopen this draft to get its disk path.';
  $('edit-shape').hidden = !active.files.shapeDocument;
  $('edit-action').textContent = row.origin==='action' ? 'Continue in Action Lab ↗' : 'Open in Action Lab ↗';
  $('edit-builder').disabled = !!active.files.actionDocument;
  $('edit-builder').title = active.files.actionDocument ? 'This draft has a rig. Use its original mesh for geometry changes, then rig the result.' : 'Edit a copy in Builder; preserve this original draft';
  $('download-reference').hidden = !active.files.image;
  const views = ['front',...Object.keys(active.files.views || {})]; $('reference-view').replaceChildren(...views.map(v => new Option(v[0].toUpperCase()+v.slice(1),v))); $('reference-view').hidden = views.length < 2;
}
function openContext(id,x,y,origin) {
  closeContext(); contextId = id; contextOrigin = origin;
  const row = rows.find(r => r.id === id); if (!row) return;
  const menu = $('context-menu'); menu.querySelector('[data-action="reference"]').disabled = !row.source; menu.querySelector('[data-action="shapes"]').disabled = row.origin !== 'shape';
  menu.querySelector('[data-action="actions"]').textContent = row.origin==='action' ? 'Continue in Action Lab' : 'Open in Action Lab';
  menu.querySelector('[data-action="builder"]').disabled = row.origin === 'action';
  menu.hidden = false; const bounds = menu.getBoundingClientRect(); menu.style.left = Math.max(8,Math.min(x,innerWidth-bounds.width-8))+'px'; menu.style.top = Math.max(8,Math.min(y,innerHeight-bounds.height-8))+'px'; menu.querySelector('button:not(:disabled)').focus();
}
function closeContext(restore = false) { $('context-menu').hidden = true; if (restore) contextOrigin?.focus(); contextId = ''; contextOrigin = null; }
function confirmDelete(row) {
  const dialog = $('confirm-dialog'); $('confirm-message').textContent = `Remove “${row.title}” from the catalogue? Its disk revisions remain available for recovery.`;
  dialog.returnValue = ''; dialog.showModal();
  return new Promise(resolve => { dialog.addEventListener('close',() => resolve(dialog.returnValue === 'delete'),{once:true}); });
}
async function deleteAsset(id) {
  check(!assetHandoffBusy,'Wait for the asset to finish opening.');
  const { asset } = await library.get(id); if (!await confirmDelete(asset)) return;
  await library.remove(id,asset.revision);
  if (active?.asset.id === id) { ++loadSerial; active = null; metadataDirty = false; fillInspector(); viewer?.sample(); $('sample-caption').hidden = false; $('viewport-title').textContent = 'A place for your next idea'; $('viewport-kind').textContent = 'SHAPE STUDIO EXAMPLE'; $('mesh-summary').textContent = 'Procedural preview'; }
  await refresh(); notify(`Deleted “${asset.title}”.`);
}
async function importGlb(file, {destination='inspector'}={}) {
  if(destination==='actions')return file?openActionAsset(null,{file}):false;
  check(!assetHandoffBusy,'Wait for the asset to finish opening.');
  if (!file) return; check(file.size > 0 && file.size <= LIMITS.glbBytes && /\.glb$/i.test(file.name), 'Choose a self-contained .glb file.');
  if (!consentToLeave()) return;
  const bytes = new Uint8Array(await file.arrayBuffer()); inspectGlb(bytes);
  const saved = await library.save({ bytes, info: { title: file.name.replace(/\.glb$/i,'').slice(0,160) || 'Imported model' }, origin:'import' });
  await refresh(); await openAsset(saved.asset.id,{force:true}); notify(saved.renamed ? `Name conflict resolved: saved as “${saved.asset.title}”.` : `Imported “${saved.asset.title}” into Drafts.`);
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click',() => showView(b.dataset.view)));
document.querySelectorAll('[data-soon]').forEach(b => b.addEventListener('click',() => { if(b.dataset.soon==='projects'){void projectWorkspace.open();}else if(b.dataset.soon==='materials'&&active){if(showView('builder'))builder.tab('texture');}else showView(b.dataset.soon); }));
document.querySelector('.brand').addEventListener('click',e => { e.preventDefault(); showView('create'); });
$('choose-image').addEventListener('click',() => $('image-input').click());
$('image-input').addEventListener('change',guard(async () => { const file = $('image-input').files[0]; $('image-input').value = ''; await selectImage(file); }));
for (const event of ['dragenter','dragover']) $('choose-image').addEventListener(event,e => { e.preventDefault(); $('choose-image').classList.add('dragging'); e.dataTransfer.dropEffect = workshop.busy ? 'none' : 'copy'; });
for (const event of ['dragleave','drop']) $('choose-image').addEventListener(event,e => { e.preventDefault(); $('choose-image').classList.remove('dragging'); });
$('choose-image').addEventListener('drop',e => { e.preventDefault(); e.stopPropagation(); const files = Array.from(e.dataTransfer?.files || []); guard(async () => { check(files.length === 1,'Drop one reference image at a time.'); await selectImage(files[0]); })(); });
for (const id of ['import-glb','library-import']) $(id).addEventListener('click',() => $('glb-input').click());
$('glb-input').addEventListener('change',guard(async () => { const file = $('glb-input').files[0]; $('glb-input').value = ''; await importGlb(file); }));
window.addEventListener('dragover',e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
window.addEventListener('drop',e => { const files = Array.from(e.dataTransfer?.files || []); if (!files.length) return; e.preventDefault(); guard(async () => { check(files.length === 1,'Drop one GLB or reference image at a time.'); const file = files[0]; if (/\.glb$/i.test(file.name)) await importGlb(file); else { if (!showView('create')) return; await selectImage(file); } })(); });
$('engine-settings').addEventListener('click',guard(() => bridge.openStudio()));
$('check-engine').addEventListener('click',guard(async () => { try { await workshop.checkStatus(); notify('Engine status refreshed.'); } catch(e) { $('engine-status').textContent = e.message; throw e; } }));
$('prepare-model').addEventListener('click',guard(async () => { await workshop.prepare(settings(),$('accept-license').checked); notify(workshop.message); }));
$('generate').addEventListener('click',guard(async () => {
  if (!consentToLeave()) return;
  const saved = await workshop.generate({ source: { ...source, views: modelById($('model').value).multiview ? { ...extraViews } : {} }, settings: settings(), info: { title: $('new-title').value } });
  await refresh(); await openAsset(saved.asset.id,{force:true}); notify(workshop.message);
}));
$('stop').addEventListener('click',guard(() => workshop.cancel()));
$('retry-save').addEventListener('click',guard(async () => { check(!workshop.busy,'Wait for the current operation to settle.'); const saved = await workshop.operation('Saving draft',() => workshop.saveRetained()); await refresh(); await openAsset(saved.asset.id); notify(workshop.message); }));
$('download-retained').addEventListener('click',guard(() => { check(workshop.unsaved,'No retained mesh.'); download(new Blob([workshop.unsaved.bytes],{type:'model/gltf-binary'}),safeFilename(workshop.unsaved.info.title)+'.glb'); notify('Download requested. The mesh remains retained until it is saved.'); }));
$('discard-retained').addEventListener('click',guard(()=>{if(confirm('Discard the retained result? Download it first if you want to keep it.'))workshop.discardRetained();}));
$('save-metadata').addEventListener('click',guard(async () => { check(active,'Open a draft first.'); const meta={title:$('asset-title').value,folder:$('asset-folder').value,tags:$('asset-tags').value,notes:$('asset-notes').value};const mode=await identityChoice(meta.title,active.asset.title);if(mode==='cancel')return;let updated;if(mode==='duplicate'){const result=await library.save({bytes:active.bytes,info:meta,origin:active.asset.origin,source:active.files.image?{...active.asset.source,blob:active.files.image,views:active.files.views}:null,generation:active.asset.recipe,actionDocument:active.files.actionDocument,shapeDocument:active.files.shapeDocument,edit:active.asset.edit});await refresh();await openAsset(result.asset.id,{force:true});return;}updated=await library.update(active.asset.id,active.asset.revision,meta);syncAssetMetadata(updated); active.asset = updated; metadataDirty = false; fillInspector(); $('viewport-title').textContent = updated.title; await refresh(); notify('Asset details saved.'); }));
for (const id of ['asset-title','asset-folder','asset-tags','asset-notes']) $(id).addEventListener('input',() => { metadataDirty = true; });
async function openTextureTouchUp(){
  check(active,'Open a textured asset first.');if(!consentToLeave())return;
  const record=active;await openAsset(record.asset.id,{force:true});
  await touchUpTexture(record.bytes,{title:record.asset.title,onSave:async bytes=>{
    const saved=await saveAsset(library,{bytes,info:{title:record.asset.title,folder:record.asset.folder,tags:record.asset.tags,notes:record.asset.notes},origin:record.asset.origin,source:record.files.image?{...record.asset.source,blob:record.files.image,views:record.files.views}:null,generation:record.asset.recipe?{...record.asset.recipe,...record.asset.result}:null,actionDocument:record.files.actionDocument,shapeDocument:record.files.shapeDocument,edit:record.asset.edit},record);
    await refresh();await openAsset(saved.asset.id,{force:true});notify('Texture layer saved · rig and actions preserved.');
  }});
}
$('texture-touch-up').addEventListener('click',guard(openTextureTouchUp));
$('download-glb').addEventListener('click',guard(() => { check(active,'Open a draft first.'); download(active.files.glb,safeFilename(active.asset.title)+'.glb'); }));
$('download-reference').addEventListener('click',guard(() => { check(active?.files.image,'No stored reference.'); download($('reference-view').value === 'front' ? active.files.image : active.files.views[$('reference-view').value].blob,safeFilename(active.asset.title)+'-'+$('reference-view').value+'-reference.png'); }));
$('delete-asset').addEventListener('click',guard(() => active && deleteAsset(active.asset.id)));
$('edit-builder').addEventListener('click',() => showView('builder'));
$('edit-action').addEventListener('click',guard(()=>active&&openActionAsset(active.asset.id)));
$('inspect-action-shortcut').addEventListener('click',guard(()=>active?openActionAsset(active.asset.id):openActionAsset(actionLab?.record?.asset?.id||null)));
$('edit-shape').addEventListener('click',guard(()=>active&&openShapeAsset(active.asset.id)));
$('side-view').addEventListener('click',() => viewer?.reset('side'));
$('recover-viewer').addEventListener('click',guard(async () => { builder?.clearHelpers(); actionLab?.clearHelpers(); await viewer?.recoverContext(); if(actionLab?.active)actionLab.rebuild(); if(builder?.active)builder.updateHelpers();if(shapeLab?.active)shapeLab.renderHelpers(); }));
$('fit-view').addEventListener('click',() => viewer?.reset()); $('front-view').addEventListener('click',() => viewer?.reset('front')); $('top-view').addEventListener('click',() => viewer?.reset('top'));
function wire(value) { viewer?.setWire(value); $('solid-view').classList.toggle('selected',!value); $('wire-view').classList.toggle('selected',value); }
$('solid-view').addEventListener('click',() => {viewer?.setSurface('original');$('clay-view').classList.remove('selected');$('clay-view').setAttribute('aria-pressed','false');wire(false);}); $('wire-view').addEventListener('click',() => wire(true));
for (const [id,method,on,off] of [['clay-view','setSurface','clay','original'],['flat-view','setShading','flat','smooth']]) $(id).addEventListener('click',() => { const enabled=$(id).getAttribute('aria-pressed')!=='true'; $(id).setAttribute('aria-pressed',String(enabled)); $(id).classList.toggle('selected',enabled); viewer?.[method](enabled ? on : off); });
$('grid-view').addEventListener('click',() => { const enabled = $('grid-view').getAttribute('aria-pressed') !== 'true'; $('grid-view').setAttribute('aria-pressed',String(enabled)); viewer?.setGrid(enabled); });
for (const id of ['search','folder-filter','type-filter']) $(id).addEventListener(id === 'search' ? 'input' : 'change',() => { page = 0; renderGrid(); });
$('previous-page').addEventListener('click',() => { page--; renderGrid(); }); $('next-page').addEventListener('click',() => { page++; renderGrid(); });
$('dismiss-notice').addEventListener('click',() => { $('notice').hidden = true; });
$('context-menu').addEventListener('click',guard(async e => {
  const button = e.target.closest('button[data-action]'), id = contextId; if (!button || button.disabled || !id) return; closeContext();
  if (button.dataset.action === 'open') return openAsset(id);
  if (button.dataset.action === 'shapes') return openShapeAsset(id);
  if (button.dataset.action === 'actions') return openActionAsset(id);
  if (button.dataset.action === 'builder') { if(await openAsset(id))showView('builder',{force:true}); return; }
  if (button.dataset.action === 'delete') return deleteAsset(id);
  if (button.dataset.action === 'project') return projectWorkspace.stageLocal(id);
  const { asset,files } = await library.get(id);
  if (button.dataset.action === 'download') download(files.glb,safeFilename(asset.title)+'.glb');
  if (button.dataset.action === 'reference') { check(files.image,'No retained reference.'); if (!showView('create')) return; await selectImage(new File([files.image],asset.source.name,{type:'image/png'})); if (asset.recipe?.model && modelById(asset.recipe.model)) { $('model').value=asset.recipe.model;updateModel();$('device').value=asset.recipe.device||'auto';$('resolution').value=String(asset.recipe.resolution??256);$('seed').value=asset.recipe.seed??0;$('steps').value=asset.recipe.steps??30;$('guidance-scale').value=asset.recipe.guidanceScale??5;$('memory-mode').value=asset.recipe.memoryMode??'gpu';$('num-chunks').value=asset.recipe.numChunks??8000;$('image-padding').value=String(asset.recipe.imagePadding??.15); } for(const key of Object.keys(extraViews))delete extraViews[key];for (const [key,ref] of Object.entries(files.views || {})) extraViews[key]=await prepareImage(new File([ref.blob],ref.name,{type:'image/png'}));renderViews(); $('new-title').value = (asset.title+' variation').slice(0,160); }
}));
$('context-menu').addEventListener('keydown',e => { const buttons = [...$('context-menu').querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement); if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length-1 : (index+(e.key === 'ArrowDown' ? 1 : -1)+buttons.length)%buttons.length; buttons[next].focus(); } if (e.key === 'Escape') { e.preventDefault(); closeContext(true); } if (e.key === 'Tab') closeContext(); });
document.addEventListener('pointerdown',e => { if (!$('context-menu').hidden && !e.target.closest('#context-menu')) closeContext(); });
window.addEventListener('resize',() => closeContext());
window.addEventListener('beforeunload',e => { if (library.pending || library.migration || authoringStorage.pending.size || authoringStorage.running || assetHandoffBusy || actionLab?.dirty || actionLab?.busy || actionLab?.hasPending || actionLab?.skeletonCandidate || actionLab?.engine.busy || workshop.busy || workshop.unsaved || metadataDirty || builder?.dirty || builder?.busy || builder?.hasPending || shapeLab?.busy || shapeLab?.hasPending || (shapeLab?.dirty && shapeLab?.sessionError)) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('pagehide',() => { ++loadSerial;actionAssetPicker?.dispose();actionLab?.engine.dispose(); actionLab?.stop(); shapeLab?.flushSession(); Promise.resolve(bridge.dispose()).catch(() => {}); library.close(); viewer?.destroy(); for (const u of thumbnailUrls) URL.revokeObjectURL(u); if (sourceUrl) URL.revokeObjectURL(sourceUrl); for(const u of Object.values(viewUrls))URL.revokeObjectURL(u); });
window.addEventListener('focus',() => { if (view === 'assets') refresh().catch(failure); });

updateModel();
$('version').textContent = VERSION;
try { viewer = new ModelViewer($('viewport'),message => { $('viewer-failure').textContent = message; $('viewer-failure').hidden = false; $('recover-viewer').hidden=false; }, state => { if(state==='restored') { if(actionLab?.active){actionLab.cancelPending();actionLab.rebuild();} $('viewer-failure').hidden=true; $('recover-viewer').hidden=true; if(builder?.active)builder.updateHelpers();if(shapeLab?.active)shapeLab.renderHelpers(); } }); viewer.sample();
  builder = new Builder(viewer,{notify,onTextureTouchUp:guard(openTextureTouchUp),onChange:state=>{ if(view==='builder') $('mesh-summary').textContent=state.triangles.toLocaleString()+' triangles · '+(state.dirty?'unsaved edits':'editable copy'); },onSave: async ({bytes,title,source,record,edits,duplicate})=>{const saved=await saveAsset(library,{bytes,info:{title,folder:record.asset.folder,tags:record.asset.tags,notes:record.asset.notes},source,origin:'edit',edit:{parentId:record.asset.id,parentSha256:record.asset.sha256,operations:edits}},record,{duplicate});try {const thumb=await viewer.thumbnail();if(thumb)await library.thumbnail(saved.asset.id,thumb);}catch{}const data=await library.get(saved.asset.id);active={...data,bytes,dimensions:null};await refresh();$('viewport-title').textContent=saved.asset.title;return active;}});
  shapeLab = new ShapeLab(viewer,{notify,storage:authoringStorage,onChange:state=>{if(view==='shapes'){$('mesh-summary').textContent=state.triangles.toLocaleString()+' triangles · editable recipe';if(shapeLab?.document)$('viewport-title').textContent=shapeLab.document.title;}},onSave:async({bytes,shapeDocument,source})=>{
    const saved=await saveAsset(library,{bytes,info:{title:shapeDocument.title,folder:shapeLab.record?.asset.folder||'',tags:shapeLab.record?.asset.tags||[],notes:shapeLab.record?.asset.notes||''},shapeDocument,source,origin:'shape'},shapeLab.record);
    try{const thumb=await viewer.thumbnail();if(thumb)await library.thumbnail(saved.asset.id,thumb);}catch{}
    const data=await library.get(saved.asset.id);active={...data,bytes,dimensions:null};await refresh();return active;
  },onBuilder:async()=>{showView('builder',{force:true});}});
  actionLab = new ActionLab(viewer,{notify,storage:authoringStorage,rigStore,onChooseAsset:()=>actionAssetPicker.open(),onImportAsset:()=>actionAssetPicker.open({chooseFile:true}),onChange:state=>{syncActionWork();if(view==='actions'){$('mesh-summary').textContent=state.triangles.toLocaleString()+' triangles · '+state.joints.length+' joints';$('viewport-title').textContent=actionLab.document.title;}},onSave:async({bytes,actionDocument,record,duplicate})=>{await workQueue;const saved=await saveAsset(library,{bytes,info:{title:actionDocument.title,folder:record?.asset.folder||'',tags:record?.asset.tags||[],notes:record?.asset.notes||''},actionDocument,origin:'action'},record,{duplicate});try{if(actionLab.active){const thumb=await viewer.thumbnail();if(thumb)await library.thumbnail(saved.asset.id,thumb);}}catch{}let data={asset:saved.asset,files:{glb:new Blob([bytes],{type:'model/gltf-binary'}),actionDocument:cloneActionDocument(actionDocument)}};try{data=await library.get(saved.asset.id);}catch(error){notify('Draft saved. Library refresh failed: '+error.message,true);}active={...data,bytes,dimensions:null};try{await refresh();}catch(error){notify('Draft saved. Asset list refresh failed: '+error.message,true);}return active;}});
  const flowAdapters=createActionFlowAdapters(actionLab,{
    reference:async()=>{check(source,'Choose a character reference in Generate first, then return to Workflows.');return {kind:'reference',source:{...source,views:{...extraViews}},title:$('new-title').value||'Workflow character',summary:'Reference image ready'};},
    generateModel:async ctx=>{
      check(ctx.input?.source,'Connect a Reference image node before Generate 3D model.');check(!workshop.busy&&!actionLab.busy,'Wait for the current model operation.');
      if(actionLab.dirty)await actionLab.save();
      const abort=()=>void workshop.cancel().catch(()=>{}),ensureActive=()=>check(!ctx.signal.aborted,'Workflow cancelled. Any completed model remains in Assets.');ctx.signal.addEventListener('abort',abort,{once:true});
      let releaseNote='';
      try{
        ensureActive();const options={...ctx.config,steps:ctx.config.steps??30,seed:ctx.config.seed??0};
        let saved;
        if(ctx.previousOutput?.generatedAssetId)saved={asset:(await library.get(ctx.previousOutput.generatedAssetId)).asset};
        else{await workshop.prepare(options,ctx.policy.acceptedModels.includes(ctx.config.model));ensureActive();saved=await workshop.generate({source:ctx.input.source,settings:options,info:{title:ctx.input.title}});ctx.checkpoint({kind:'character',generatedAssetId:saved.asset.id,summary:'Generated model saved; opening in Action Lab.'});}
        ensureActive();
        const data=await library.get(saved.asset.id),bytes=new Uint8Array(await data.files.glb.arrayBuffer()),record={...data,bytes,dimensions:null};
        const prepared=await prepareActionAsset(bytes,record);if(ctx.signal.aborted){disposeComponent(prepared.base);ensureActive();}
        try{actionLab.open(record,{prepared});}catch(error){disposeComponent(prepared.base);throw error;}
        active=record;metadataDirty=false;try{await refresh();fillInspector();}catch(error){releaseNote=' Model saved; asset list refresh failed: '+error.message;}
        if(ctx.config.unloadAfter){if(typeof bridge.client?.unload==='function'){try{await bridge.client.unload();}catch(error){releaseNote+=' Model retained; unload failed: '+error.message;}}else releaseNote+=' The installed 3D provider has no unload API; use its model controls if memory is needed.';}
        return {kind:'character',sceneToken:actionLab.sceneToken,assetId:saved.asset.id,title:saved.asset.title,jointCount:actionLab.document.joints.length,clipIds:actionLab.document.clips.map(c=>c.id),summary:'Generated mesh saved and opened.'+releaseNote};
      }finally{ctx.signal.removeEventListener('abort',abort);}
    }
  });
  actionFlow=new ActionFlowEditor({storage:authoringStorage,adapters:flowAdapters,notify,getPromptLibrary:()=>actionLab.composer.library,getRigTemplates:()=>actionLab.rigEditor.store.list(),models:[...ACTION_MODELS,...MODELS],onChange:state=>{document.querySelector('main').inert=state.status==='running';actionLab.flowRunning=state.status==='running';}});
  $('a-send-foundry').onclick=guard(async()=>{check(!actionLab.flowRunning,'Finish or pause the workflow first.');if(actionLab.dirty||!actionLab.record?.asset?.id)await actionLab.save();await projectWorkspace.stageLocal(actionLab.record.asset.id);});
  $('a-reload-saved').onclick=guard(()=>{check(actionLab.record?.asset.id,'Save this asset first.');return openActionAsset(actionLab.record.asset.id,{reload:true});});$('a-save-copy').onclick=guard(()=>actionLab.save({duplicate:true}));$('b-save-copy').onclick=guard(()=>builder.save({duplicate:true}));
  const work=document.createElement('section');work.className='work-selection';work.innerHTML='<h3>Work package</h3><label><input id="a-work-package" type="checkbox"> Include in work ZIP</label><label class="field">Work to continue<textarea id="a-work-notes" maxlength="4000" placeholder="What should Codex do with this asset?"></textarea></label><button id="a-work-save">Save ZIP selection and notes</button><p class="helper">Save the model first. Selected models include their complete rig, actions and references.</p>';$('a-send-foundry').before(work);
  let workId=null;
  syncActionWork=()=>{const row=actionLab.record?.asset,id=row?row.id+':'+row.revision:null;for(const key of ['a-work-package','a-work-notes','a-work-save'])$(key).disabled=!!actionLab.busy||!row;if(workWrites||document.activeElement===$('a-work-notes'))return;if(workId!==id){workId=id;$('a-work-package').checked=!!row?.workPackage;$('a-work-notes').value=row?.workNotes||'';}};
  $('a-work-save').onclick=guard(()=>{const id=actionLab.record?.asset.id;check(id,'Save the asset first.');const included=$('a-work-package').checked,notes=$('a-work-notes').value;++workWrites;
   const task=workQueue.then(async()=>{check(actionLab.record?.asset.id===id,'The selected asset changed. Review its work selection.');const row=actionLab.record.asset,updated=await library.curate(id,row.revision,included,notes);syncAssetMetadata(updated);await refresh();notify('Work ZIP selection saved on disk.');}).finally(()=>{--workWrites;syncActionWork();});workQueue=task.catch(()=>{});return task;});
  $('a-work-package').onchange=()=>$('a-work-save').click();$('a-work-notes').onchange=()=>$('a-work-save').click();syncActionWork();
  actionAssetPicker=new ActionAssetPicker({library,onOpen:id=>openActionAsset(id),onImport:file=>importGlb(file,{destination:'actions'}),getCurrentId:()=>actionLab.record?.asset?.id||null});
  viewportWorkspace = initViewportWorkspace({viewer,getBuilder:()=>builder,getShape:()=>shapeLab,getAction:()=>actionLab});
}
catch(e) { $('viewer-failure').textContent = '3D preview is unavailable: '+e.message+'. Draft storage and downloads still work.'; $('viewer-failure').hidden = false; $('sample-caption').hidden = true; }
renderOperation();
refresh().catch(e => { $('storage-status').textContent = 'Draft storage unavailable'; failure(e); });
workshop.checkStatus().catch(e => { $('engine-status').textContent = e.message; });
window.threeLab = Object.freeze({ actions:Object.freeze({get recipe(){return actionLab?.document?cloneActionDocument(actionLab.document):null;},get flow(){return actionFlow?.state||null;},getWorkflow:()=>actionFlow.getFlow(),setWorkflow:value=>{check(!actionLab?.busy&&!actionLab?.flowRunning,'Wait for the current operation.');return actionFlow.setFlow(value);},runWorkflow:policy=>{check(!workshop.busy&&!actionLab.busy&&!actionLab.engine.busy,'Wait for the current operation.');return actionFlow.run(policy);},resumeWorkflow:()=>actionFlow.resume(),retryWorkflow:()=>actionFlow.retry(),cancelWorkflow:()=>actionFlow.cancel(),openWorkflow:()=>actionFlow.open(),listRigs:()=>actionLab.rigEditor.store.list(),getRig:id=>actionLab.rigEditor.store.get(id),addEquipment:config=>{check(!actionLab.flowRunning,'Wait for the workflow.');return actionLab.equipmentEditor.addFromConfig(config);},save:()=>{check(!actionLab.flowRunning,'Wait for the workflow.');return actionLab.save();},open:id=>openActionAsset(id)}), protocol:'capp.3d-lab.v1', version:VERSION, refresh, get state() { return { busy:workshop.busy, assetLoading:assetHandoffBusy, stopping:workshop.stopping, retained:!!workshop.unsaved, assets:rows.length, selected:active?.asset.id || null, view, action:actionLab?.getState()||null, shape:shapeLab?.getState()||null, builder:builder ? {active:builder.active,dirty:builder.dirty,busy:builder.busy,history:builder.history.length,tool:builder.tool,pending:builder.hasPending,outlinePoints:builder.outline?.points.length||0,selectedId:builder.primary()?.userData.builderId||null,parts:builder.active?builder.meshes().map(m=>({id:m.userData.builderId,name:m.name,visible:m.visible,locked:!!m.userData.builderLocked})):[],fullscreen:!!viewportWorkspace?.fullscreen,viewer:{cursorVisible:!!viewer?.toolCursor.group.visible,brushVisible:!!(viewer?.toolCursor.group.visible&&viewer?.toolCursor.brush.visible),camera:viewer?.camera.position.toArray(),target:viewer?.controls.target.toArray(),outlineVisible:!!builder.outlineHelper},triangles:builder.active ? builder.meshes().reduce((n,m)=>n+(m.geometry.index?.count || m.geometry.attributes.position.count)/3,0) : 0} : null }; } });

const initialAssetStorage=new URLSearchParams(location.hash.slice(1)).get('assetStorage');
let storageStartup=Promise.resolve();
projectWorkspace=createProjectWorkspace({library,refresh,openAsset,openActionAsset,openShapeAsset,beforeOpen:()=>storageStartup});
$('project-assets-open').addEventListener('click',()=>void projectWorkspace.open());
window.addEventListener('pagehide',()=>{actionFlow?.cancel();projectWorkspace?.dispose();});

const storagePanel=mountStoragePanel({library,authoring:authoringStorage,initialLink:initialAssetStorage,onConnected:async()=>{
 await refresh();
 if(actionLab?.composer){const c=actionLab.composer;c.library=new PromptLibrary(authoringStorage);c.populate();c.storageState();}
 if(actionLab?.rigEditor)await actionLab.rigEditor.refresh();
 if(actionFlow){actionFlow.readSaved();actionFlow.renderSaved();}
}});
storageStartup=storagePanel.start();

$('copy-model-path').onclick=guard(async()=>{check(active?.modelPath,'Reconnect asset storage and reopen this draft.');await navigator.clipboard.writeText(active.modelPath);notify('Permanent GLB path copied.');});

function syncAssetMetadata(updated){if(active?.asset.id===updated.id)active.asset=updated;if(actionLab?.record?.asset.id===updated.id){if(actionLab.document?.title===actionLab.record.asset.title)actionLab.document.title=updated.title;actionLab.record.asset=updated;}if(builder?.record?.asset.id===updated.id){if($('b-title').value===builder.record.asset.title)$('b-title').value=updated.title;builder.record.asset=updated;}if(shapeLab?.record?.asset.id===updated.id){if(shapeLab.document.title===shapeLab.record.asset.title)shapeLab.document.title=updated.title;shapeLab.record.asset=updated;}}
