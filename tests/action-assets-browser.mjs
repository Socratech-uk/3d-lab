/** Built application, real IndexedDB, GLB import/export and editing.
 * Animation responses below are explicitly controlled UI fixtures, not inference.
 * Run after npm run build, with PLAYWRIGHT_PATH and CHROMIUM_PATH when needed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fixtureGlb} from './fixtures.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.env.TEST_OUTPUT||path.join(root,'test-output','action-assets'));
await fs.mkdir(output,{recursive:true});
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
const {chromium}=process.env.PLAYWRIGHT_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href):await import('playwright');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,...(process.env.CHROMIUM_PATH?{LD_LIBRARY_PATH:path.dirname(process.env.CHROMIUM_PATH)}:{})}});
const context=await browser.newContext({viewport:{width:1536,height:1000},acceptDownloads:true});
const errors=[],network=[],checks=[];
await context.route('**/*',route=>{
 if(route.request().url()==='https://action-assets.test/')return route.fulfill({status:200,contentType:'text/html',body:html});
 network.push(route.request().url());return route.abort();
});
await context.addInitScript(()=>{
 const fixture=window.__assetAnimation={loaded:null,held:false,calls:[],release:null};
 const client={status:async()=>({models:['unimate','momask','unirig'].map(id=>({id,name:id,available:true,loaded:fixture.loaded===id}))}),
  prepare:async o=>{fixture.calls.push({op:'prepare',model:o.model});fixture.loaded=o.model;return {deviceName:'Controlled browser fixture'};},
  render:async o=>{fixture.calls.push({op:'render',model:o.model});if(fixture.held)await new Promise(resolve=>fixture.release=resolve);return {skeleton:{format:'capp.skeleton.v1',joints:[{name:'Hips',parent:-1,position:[0,0,0]},{name:'Spine',parent:0,position:[0,.5,0]},{name:'Head',parent:1,position:[0,1,0]}]}};},
  cancel:async()=>{fixture.loaded=null;fixture.release?.();return {cancelled:true};},unload:async()=>{fixture.loaded=null;return {};},dispose:()=>{}};
 window.capp={ai:{local:{animation:{connect:()=>client}}}};
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
page.setDefaultTimeout(12000);
const run=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
const state=()=>page.evaluate(()=>threeLab.state);
const snapshot=()=>page.evaluate(()=>({selected:threeLab.state.selected,action:threeLab.state.action}));
const settle=()=>page.waitForFunction(()=>!threeLab.state.assetLoading&&!threeLab.state.action?.busy);
const openPicker=async()=>{await page.locator('#a-choose-asset').click();await page.locator('#action-asset-picker').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#a-assets-search').disabled);};
const card=id=>page.locator(`#a-assets-list [data-asset-id="${id}"]`);
const select=async id=>{await page.locator('#a-assets-search').fill('');await page.locator('#a-assets-folder').selectOption('');await page.locator('#a-assets-type').selectOption('');await card(id).click();};
const choose=async(id,decision)=>{await openPicker();await select(id);await page.locator('#a-assets-open').click();if(decision)await page.locator('#action-switch-'+decision).click();await page.locator('#action-asset-picker').waitFor({state:'hidden'});await settle();};
const bytes=async selector=>{const [download]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);return fs.readFile(await download.path());};
const recipe=async()=>JSON.parse(await bytes('#a-export-recipe'));
const readRecords=()=>page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('capp.3d-lab.assets.v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 const records=await new Promise((resolve,reject)=>{const tx=db.transaction(['assets','files']),a=tx.objectStore('assets').getAll(),f=tx.objectStore('files').getAll();tx.oncomplete=()=>resolve(a.result.map(asset=>({asset,files:f.result.find(x=>x.id===asset.id)})));tx.onerror=()=>reject(tx.error);});db.close();
 return Promise.all(records.map(async({asset,files})=>({asset,actionDocument:files.actionDocument||null,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await files.glb.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('')})));
});
const mutateStore=(operation)=>page.evaluate(async operation=>{
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('capp.3d-lab.assets.v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction(['assets','files'],'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);const store=tx.objectStore(operation.store);if(operation.delete)store.delete(operation.id);else{const q=store.get(operation.id);q.onsuccess=()=>store.put({...q.result,...operation.patch});}});db.close();await threeLab.refresh();
},operation);
const changeTitle=async title=>{await page.locator('#a-title').fill(title);await page.locator('#a-title').dispatchEvent('change');await page.waitForFunction(()=>threeLab.state.action.dirty);};
const glb=Buffer.from(fixtureGlb());
function skinAndAnimationData(bytes){
 const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString().trim()),binaryOffset=28+jsonLength;
 const getters={5120:['getInt8',1],5121:['getUint8',1],5122:['getInt16',2],5123:['getUint16',2],5125:['getUint32',4],5126:['getFloat32',4]},components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const accessor=id=>{const a=json.accessors[id],b=json.bufferViews[a.bufferView],[get,width]=getters[a.componentType],size=components[a.type],offset=binaryOffset+(b.byteOffset||0)+(a.byteOffset||0);return Array.from({length:a.count*size},(_,i)=>view[get](offset+Math.floor(i/size)*(b.byteStride||size*width)+(i%size)*width,true));};
 return {skins:(json.skins||[]).map(s=>({joints:s.joints.length,inverseBindMatrices:accessor(s.inverseBindMatrices)})),weights:json.meshes.flatMap(m=>m.primitives.filter(p=>p.attributes.JOINTS_0!==undefined).map(p=>({joints:accessor(p.attributes.JOINTS_0),weights:accessor(p.attributes.WEIGHTS_0)}))),animations:(json.animations||[]).map(a=>({name:a.name,samples:a.samplers.map(s=>({interpolation:s.interpolation,input:accessor(s.input),output:accessor(s.output)}))}))};
}
function alterGlb(bytes,change){const length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length).toString().trim());change(doc);const text=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(json);const header=Buffer.from(bytes.subarray(0,20)),binary=bytes.subarray(20+length);header.writeUInt32LE(20+json.length+binary.length,8);header.writeUInt32LE(json.length,12);return Buffer.concat([header,json,binary]);}
function closeData(actual,expected,label='GLB'){if(typeof expected==='number'){assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=1e-6,`${label}: ${actual} differs from ${expected}`);return;}if(expected&&typeof expected==='object'){assert.deepEqual(Object.keys(actual),Object.keys(expected),`${label} structure`);for(const key of Object.keys(expected))closeData(actual[key],expected[key],label+'.'+key);return;}assert.equal(actual,expected,label);}
let originalId,secondId,savedActionId,savedRecipe,savedGlb,originalRecord;
async function saveReport(extra={}){await fs.writeFile(path.join(output,'result.json'),JSON.stringify({checks,errors,network,testedInputs:{builtIndexSha256:createHash('sha256').update(html).digest('hex'),browserTestSha256:createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex')},scope:'Built Lab, real browser IndexedDB and GLB parser/exporter. Controlled animation bridge tests only busy/candidate UX, not inference.',windowsExecutionVerified:false,...extra},null,2));}

try{
 await page.goto('https://action-assets.test/');await page.waitForFunction(()=>window.threeLab?.state);
 await run('Action Lab exposes asset choice and import with beginner guidance on first visit',async()=>{
  await page.locator('.primary-nav [data-view="actions"]').click();await page.waitForFunction(()=>threeLab.state.action?.active);
  assert.equal(await page.locator('#a-choose-asset').isVisible(),true);assert.equal(await page.locator('#a-import-asset').isVisible(),true);
  assert.ok((await page.locator('#a-workflow-next').textContent()).trim());await openPicker();assert.equal(await page.locator('#a-assets-list [data-asset-id]').count(),0);assert.equal(await page.locator('#a-assets-open').isDisabled(),true);await page.locator('#a-assets-close').click();
 });
 await run('Import from Action Lab saves a real GLB and opens it directly for rigging',async()=>{
  await page.locator('#a-import-asset').click();await page.locator('#a-assets-file').setInputFiles({name:'Pilot source.glb',mimeType:'model/gltf-binary',buffer:glb});
  await page.locator('#action-switch-discard').click();
  await page.waitForFunction(()=>threeLab.state.assets===1&&threeLab.state.action?.source?.id&&!threeLab.state.assetLoading);originalId=(await state()).action.source.id;
  assert.equal((await state()).view,'actions');assert.equal((await state()).action.joints.length,0);assert.equal((await state()).action.workflow.stage,'rig');assert.match(await page.locator('#a-source-name').textContent(),/Pilot source/);
  originalRecord=(await readRecords()).find(r=>r.asset.id===originalId);assert.equal(originalRecord.sha256,createHash('sha256').update(glb).digest('hex'));
 });
 await run('Asset browser searches names, folder, tags and notes; filters and selection are explicit',async()=>{
  await mutateStore({store:'assets',id:originalId,patch:{folder:'Characters',tags:['pilot','human'],notes:'Flight crew rigging source'}});
  await page.locator('#a-import-asset').click();await page.locator('#a-assets-file').setInputFiles({name:'Cargo door.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(fixtureGlb(j=>j.nodes[0].name='Door panel'))});
  await page.waitForFunction(()=>threeLab.state.assets===2&&!threeLab.state.assetLoading);secondId=(await state()).action.source.id;await mutateStore({store:'assets',id:secondId,patch:{folder:'Ships',tags:['mechanical']}});
  originalRecord=(await readRecords()).find(r=>r.asset.id===originalId);
  await openPicker();await page.locator('#a-assets-search').fill('pilot flight');assert.equal(await page.locator('#a-assets-list [data-asset-id]').count(),1);assert.match(await card(originalId).textContent(),/Pilot source/);
  await page.locator('#a-assets-search').fill('');await page.locator('#a-assets-folder').selectOption('Ships');assert.equal(await page.locator('#a-assets-list [data-asset-id]').count(),1);assert.equal(await card(secondId).count(),1);
  await page.locator('#a-assets-folder').selectOption('');await page.locator('#a-assets-type').selectOption('action');assert.equal(await page.locator('#a-assets-list [data-asset-id]').count(),0);
  await page.locator('#a-assets-type').selectOption('import');await card(originalId).click();assert.equal((await state()).action.source.id,secondId);assert.equal(await card(originalId).getAttribute('aria-pressed'),'true');await page.locator('#a-assets-open').click();await page.locator('#action-asset-picker').waitFor({state:'hidden'});await settle();assert.equal((await state()).action.source.id,originalId);
 });
 await run('Larger collections paginate and name sorting remains predictable',async()=>{
  await page.evaluate(async id=>{const db=await new Promise(resolve=>{const r=indexedDB.open('capp.3d-lab.assets.v1');r.onsuccess=()=>resolve(r.result);});const [asset,files]=await new Promise(resolve=>{const tx=db.transaction(['assets','files']),a=tx.objectStore('assets').get(id),f=tx.objectStore('files').get(id);tx.oncomplete=()=>resolve([a.result,f.result]);});window.__pagingAssets=[];await new Promise(resolve=>{const tx=db.transaction(['assets','files'],'readwrite');for(let i=0;i<15;i++){const id='test-paging-'+i;window.__pagingAssets.push(id);tx.objectStore('assets').put({...asset,id,title:'Archive '+String(i).padStart(2,'0')});tx.objectStore('files').put({...files,id});}tx.oncomplete=resolve;});db.close();await threeLab.refresh();},originalId);
  await openPicker();await page.locator('#a-assets-sort').selectOption('name');assert.equal(await page.locator('#a-assets-list [data-asset-id]').count(),12);assert.match(await page.locator('#a-assets-list [data-asset-id]').first().textContent(),/Archive 00/);await page.locator('#a-assets-next').click();assert.equal(await page.locator('#a-assets-list [data-asset-id]').count(),5);assert.equal(await page.locator('#a-assets-next').isDisabled(),true);await page.locator('#a-assets-previous').click();assert.equal(await page.locator('#a-assets-list [data-asset-id]').count(),12);await page.locator('#a-assets-close').click();
  await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('capp.3d-lab.assets.v1');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction(['assets','files'],'readwrite');for(const id of window.__pagingAssets){tx.objectStore('assets').delete(id);tx.objectStore('files').delete(id);}tx.oncomplete=resolve;});db.close();delete window.__pagingAssets;await threeLab.refresh();});
 });
 await run('Right click, ellipsis and keyboard menus all offer direct Action Lab handoff',async()=>{
  await page.locator('.primary-nav [data-view="assets"]').click();const asset=page.locator(`[data-asset="${secondId}"]`);
  await asset.click({button:'right'});assert.equal(await page.locator('#context-menu [data-action="actions"]').isEnabled(),true);await page.keyboard.press('Escape');
  await asset.locator('.card-menu').click();assert.equal(await page.locator('#context-menu [data-action="actions"]').isVisible(),true);await page.keyboard.press('Escape');
  await asset.focus();await page.keyboard.press('Shift+F10');await page.locator('#context-menu [data-action="actions"]').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(id=>threeLab.state.view==='actions'&&threeLab.state.action.source.id===id&&!threeLab.state.assetLoading,secondId);
  assert.equal((await state()).action.joints.length,0);assert.equal(await page.locator('#action-asset-picker').isVisible(),false);
  await page.locator('.primary-nav [data-view="create"]').click();await page.locator('#edit-action').click();await page.waitForFunction(id=>threeLab.state.view==='actions'&&threeLab.state.action.source.id===id&&!threeLab.state.assetLoading,secondId);
 });
 await run('Maximum-length asset titles open without overflowing the editable title limit',async()=>{
  await choose(originalId);const title='A'.repeat(160);await mutateStore({store:'assets',id:secondId,patch:{title}});await choose(secondId);assert.equal((await recipe()).title.length,160);assert.equal((await state()).action.source.title,title);await mutateStore({store:'assets',id:secondId,patch:{title:'Cargo door'}});await choose(originalId);await choose(secondId);
 });
 await run('Same-source reopening retains unsaved rig changes and Undo history',async()=>{
  await page.locator('#a-add-template').click();const before=await snapshot();assert.ok(before.action.joints.length>0);assert.equal(before.action.dirty,true);
  await choose(secondId);const after=await snapshot();assert.deepEqual(after.action.joints,before.action.joints);assert.equal(after.action.history,before.action.history);assert.equal(after.action.dirty,true);
  await openPicker();await card(secondId).focus();await page.keyboard.press('Enter');await page.locator('#action-asset-picker').waitFor({state:'hidden'});await openPicker();await card(secondId).dblclick();await page.locator('#action-asset-picker').waitFor({state:'hidden'});assert.deepEqual((await state()).action.joints,before.action.joints);
 });
 await run('Switch Cancel preserves the complete document and keeps the picker available',async()=>{
  const before=await recipe();await openPicker();await select(originalId);await page.locator('#a-assets-open').click();await page.locator('#action-switch-cancel').focus();for(const key of ['Tab','Tab','Tab','Shift+Tab','Shift+Tab','Shift+Tab']){await page.keyboard.press(key);assert.equal(await page.locator('#action-switch-dialog').evaluate(e=>e.contains(document.activeElement)),true);}await page.locator('#action-switch-cancel').click();
  await page.locator('#action-switch-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#action-asset-picker').isVisible(),true);await page.locator('#a-assets-close').click();assert.deepEqual(await recipe(),before);assert.equal((await state()).action.source.id,secondId);
 });
 await run('Switch Discard is explicit and loads the chosen static mesh without old joints',async()=>{
  await choose(originalId,'discard');assert.equal((await state()).action.source.id,originalId);assert.equal((await state()).action.joints.length,0);assert.equal((await state()).action.dirty,false);
 });
 await run('Save and switch stores the rig, weights and named keys as a separate action asset',async()=>{
  await page.locator('[data-action-tab="rig"]').click();await page.locator('#a-demo-human').click();await page.waitForFunction(()=>threeLab.state.action.joints.length===21);await changeTitle('Pilot walk study');
  await page.locator('#a-mode-pose').click();await page.locator('#a-key-all').click();await page.locator('#a-time').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('[data-action-tab="joint"]').click();await page.locator('#a-rotation-z').fill('12');await page.locator('#a-apply-pose').click();await page.locator('#a-key-all').click();
  savedRecipe=await recipe();savedGlb=await bytes('#a-export');assert.ok(savedRecipe.joints.length===21);assert.ok(Object.values(savedRecipe.bindings).every(b=>b.mode==='skin'));assert.ok(Object.values(savedRecipe.clips[0].tracks).some(keys=>keys.length===2));
  const count=(await state()).assets;await choose(secondId,'save');await page.waitForFunction(count=>threeLab.state.assets===count+1,count);const saved=(await readRecords()).find(r=>r.asset.title==='Pilot walk study');assert.ok(saved);savedActionId=saved.asset.id;assert.equal(saved.asset.origin,'action');assert.deepEqual(saved.actionDocument,savedRecipe);assert.equal((await state()).action.source.id,secondId);
 });
 await run('Reopen action draft restores all rig, binding, constraint and clip data',async()=>{
  await choose(savedActionId);assert.deepEqual(await recipe(),savedRecipe);const beforeGlb=JSON.parse(savedGlb.subarray(20,20+savedGlb.readUInt32LE(12)).toString().trim());const reopenedBytes=await bytes('#a-export'),afterGlb=JSON.parse(reopenedBytes.subarray(20,20+reopenedBytes.readUInt32LE(12)).toString().trim());
  assert.equal(afterGlb.skins.length,beforeGlb.skins.length);assert.equal(afterGlb.animations.length,beforeGlb.animations.length);assert.equal(afterGlb.meshes.length,beforeGlb.meshes.length);closeData(skinAndAnimationData(reopenedBytes),skinAndAnimationData(savedGlb));assert.equal((await state()).action.dirty,false);await page.locator('#a-play').click();await page.waitForFunction(()=>threeLab.state.action.playing&&threeLab.state.action.time>0);await page.locator('#a-play').click();
 });
 await run('The first async asset switch owns the request and prevents overlapping user switches',async()=>{
  await openPicker();await select(originalId);await page.evaluate(size=>{const original=Blob.prototype.arrayBuffer;window.__heldAssetRead=false;window.__restoreAssetRead=()=>Blob.prototype.arrayBuffer=original;Blob.prototype.arrayBuffer=async function(){if(this.size===size){window.__heldAssetRead=true;await new Promise(resolve=>window.__releaseAssetRead=resolve);}return original.call(this);};},glb.length);
  await page.locator('#a-assets-open').click();await page.waitForFunction(()=>window.__heldAssetRead&&threeLab.state.assetLoading);assert.equal(await page.locator('#a-assets-open').isDisabled(),true);assert.equal(await page.locator('#a-assets-search').isDisabled(),true);assert.equal(await page.locator('#a-assets-import').isDisabled(),true);assert.equal(await card(secondId).isDisabled(),true);
  await page.evaluate(()=>{__restoreAssetRead();__releaseAssetRead();});await page.locator('#action-asset-picker').waitFor({state:'hidden'});await settle();assert.equal((await state()).action.source.id,originalId);await choose(savedActionId);assert.deepEqual(await recipe(),savedRecipe);
 });
 await run('Immediate workspace return cancels stale static previews and retains the open action session',async()=>{
  const before=await recipe();await page.locator('#a-mode-pose').click();await page.locator('#a-time').evaluate(el=>{el.value='.5';el.dispatchEvent(new Event('input',{bubbles:true}));});
  for(const destination of ['create','assets']){await page.evaluate(destination=>{document.querySelector(`.primary-nav [data-view="${destination}"]`).click();document.querySelector('.primary-nav [data-view="actions"]').click();},destination);await page.waitForFunction(()=>threeLab.state.view==='actions'&&!threeLab.state.assetLoading);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal((await state()).action.source.id,savedActionId);assert.deepEqual(await recipe(),before);assert.equal(await page.locator('#viewer-failure').isVisible(),false);}
 });
 await run('An imported animated GLB keeps the embedded rig, skin weights and keys',async()=>{
  const before=(await state()).assets;await page.locator('#a-import-asset').click();await page.locator('#a-assets-file').setInputFiles({name:'Portable pilot.glb',mimeType:'model/gltf-binary',buffer:savedGlb});await page.waitForFunction(count=>threeLab.state.assets===count+1&&!threeLab.state.assetLoading,before);assert.deepEqual(await recipe(),savedRecipe);assert.equal((await state()).action.joints.length,21);assert.ok((await state()).action.actions[0].keys>=42);await choose(savedActionId);
 });
 await run('Failed Save and switch leaves current work intact and permits cancellation',async()=>{
  await changeTitle('Unsaved important revision');const before=await recipe();await page.evaluate(()=>{const original=IDBObjectStore.prototype.add;window.__restoreAssetAdd=()=>IDBObjectStore.prototype.add=original;IDBObjectStore.prototype.add=function(value,...args){if(this.name==='files')throw new DOMException('Injected quota failure','QuotaExceededError');return original.call(this,value,...args);};});
  await openPicker();await select(originalId);await page.locator('#a-assets-open').click();await page.locator('#action-switch-save').click();await page.waitForFunction(()=>document.querySelector('#action-switch-error').textContent.trim());
  assert.equal(await page.locator('#action-switch-dialog').isVisible(),true);await page.evaluate(()=>__restoreAssetAdd());await page.locator('#action-switch-cancel').click();await page.locator('#a-assets-close').click();assert.deepEqual(await recipe(),before);assert.equal((await state()).action.dirty,true);
 });
 await run('Malformed import is rejected before replacing or saving current edits',async()=>{
  const before=await recipe(),count=(await state()).assets;await page.locator('#a-import-asset').click();await page.locator('#a-assets-file').setInputFiles({name:'broken.glb',mimeType:'model/gltf-binary',buffer:Buffer.from('broken')});
  await page.waitForFunction(()=>!threeLab.state.assetLoading);assert.equal((await state()).assets,count);assert.equal((await state()).action.source.id,savedActionId);assert.equal(await page.locator('#action-switch-dialog').isVisible(),false);if(await page.locator('#action-asset-picker').isVisible())await page.locator('#a-assets-close').click();assert.deepEqual(await recipe(),before);
 });
 await run('A valid GLB with unsupported morph geometry is decoded and rejected without scene loss',async()=>{
  const before=await recipe(),count=(await state()).assets;await page.locator('#a-import-asset').click();await page.locator('#a-assets-file').setInputFiles({name:'morph.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(fixtureGlb(j=>{j.meshes[0].primitives[0].targets=[{POSITION:0}];}))});
  await page.waitForFunction(()=>!threeLab.state.assetLoading);assert.equal((await state()).assets,count);assert.equal(await page.locator('#action-switch-dialog').isVisible(),false);if(await page.locator('#action-asset-picker').isVisible())await page.locator('#a-assets-close').click();assert.deepEqual(await recipe(),before);
 });
 await run('An incompatible imported bind pose is rejected without corrupting the current rig',async()=>{
  const before=await recipe(),count=(await state()).assets,bad=alterGlb(savedGlb,doc=>{const joint=doc.nodes[doc.skins[0].joints[0]];joint.translation=[...(joint.translation||[0,0,0])];joint.translation[0]+=2;delete joint.matrix;});await page.locator('#a-import-asset').click();await page.locator('#a-assets-file').setInputFiles({name:'mismatched-bind.glb',mimeType:'model/gltf-binary',buffer:bad});
  await page.waitForFunction(()=>!threeLab.state.assetLoading);assert.equal((await state()).assets,count);assert.equal(await page.locator('#action-switch-dialog').isVisible(),false);if(await page.locator('#action-asset-picker').isVisible())await page.locator('#a-assets-close').click();assert.deepEqual(await recipe(),before);
 });
 await run('A removed asset fails safely without losing the edited scene',async()=>{
  const before=await recipe();await openPicker();await select(originalId);await page.evaluate(async id=>{const db=await new Promise(resolve=>{const r=indexedDB.open('capp.3d-lab.assets.v1');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('files','readwrite'),s=tx.objectStore('files'),r=s.get(id);r.onsuccess=()=>{window.__removedAssetFiles=r.result;s.delete(id);};tx.oncomplete=resolve;});db.close();},originalId);await page.locator('#a-assets-open').click();await page.waitForFunction(()=>!threeLab.state.assetLoading&&document.querySelector('#a-assets-status').textContent.trim());assert.equal(await page.locator('#action-switch-dialog').isVisible(),false);await page.locator('#a-assets-close').click();assert.deepEqual(await recipe(),before);
  await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('capp.3d-lab.assets.v1');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(window.__removedAssetFiles);tx.oncomplete=resolve;});db.close();delete window.__removedAssetFiles;});
 });
 await run('Asset names are rendered as text, and picker keyboard focus stays within its dialog',async()=>{
  const attack='<img src=x onerror="window.assetNameExecuted=true">';await mutateStore({store:'assets',id:secondId,patch:{title:attack}});await openPicker();await page.locator('#a-assets-search').fill('onerror');assert.equal(await page.locator('#a-assets-list img[src="x"]').count(),0);assert.match(await card(secondId).textContent(),/onerror/);assert.equal(await page.evaluate(()=>window.assetNameExecuted),undefined);
  await page.locator('#a-assets-search').focus();for(let i=0;i<18;i++){await page.keyboard.press(i<9?'Tab':'Shift+Tab');const focus=await page.evaluate(()=>({inside:document.querySelector('#action-asset-picker').contains(document.activeElement),tag:document.activeElement.tagName,id:document.activeElement.id,hasFocus:document.hasFocus()}));assert.equal(focus.inside,true,`Tab ${i+1}: ${JSON.stringify(focus)}`);}await page.locator('#a-assets-close').focus();await page.keyboard.press('Escape');await page.locator('#action-asset-picker').waitFor({state:'hidden'});assert.equal(await page.locator('#a-choose-asset').evaluate(e=>document.activeElement===e),true);
  await mutateStore({store:'assets',id:secondId,patch:{title:'Cargo door'}});
 });
 await run('Asset replacement is blocked during an owned model operation and skeleton review',async()=>{
  await choose(secondId,'discard');await page.locator('[data-action-tab="motion"]').click();if(!await page.locator('#a-ai-setup').evaluate(e=>e.open))await page.locator('#a-ai-setup > summary').click();await page.locator('#a-ai-model').selectOption('unirig');await page.locator('#a-ai-license').check();await page.locator('#a-ai-prepare').click();await page.waitForFunction(()=>__assetAnimation.loaded==='unirig'&&!threeLab.state.action.busy);await page.evaluate(()=>__assetAnimation.held=true);await page.locator('#a-ai-rig').click();await page.waitForFunction(()=>threeLab.state.action.busy);
  assert.equal(await page.locator('#a-choose-asset').isDisabled(),true);assert.equal(await page.locator('#a-import-asset').isDisabled(),true);await page.evaluate(()=>__assetAnimation.release());await page.waitForFunction(()=>threeLab.state.action.skeletonCandidate&&!threeLab.state.action.busy);assert.equal(await page.locator('#a-choose-asset').isDisabled(),true);assert.equal(await page.locator('#a-import-asset').isDisabled(),true);await page.locator('#a-ai-discard-skeleton').click();await page.waitForFunction(()=>!threeLab.state.action.skeletonCandidate);assert.equal(await page.locator('#a-choose-asset').isEnabled(),true);
 });
 await run('Mobile and fullscreen retain accessible asset picking without horizontal overflow',async()=>{
  await page.locator('[data-action-tab="rig"]').click();for(const width of [768,390]){await page.setViewportSize({width,height:900});await openPicker();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`page overflow at ${width}`);assert.equal(await page.locator('#action-asset-picker').evaluate(e=>e.getBoundingClientRect().width<=innerWidth),true);assert.equal(await page.locator('#a-assets-search').isVisible(),true);if(width===390)await page.screenshot({path:path.join(output,'action-assets-mobile-internal.png'),fullPage:true});await page.locator('#a-assets-close').click();}
  await page.setViewportSize({width:1536,height:1000});await changeTitle('Fullscreen unsaved study');const before=await recipe();await page.locator('.viewport-fullscreen-button').click();await page.waitForFunction(()=>document.body.classList.contains('viewport-fullscreen-active'));await openPicker();assert.equal(await page.locator('#action-asset-picker').isVisible(),true);await select(savedActionId);await page.locator('#a-assets-open').click();await page.locator('#action-switch-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#action-switch-save').isVisible(),true);await page.keyboard.press('Escape');await page.locator('#action-switch-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#action-asset-picker').isVisible(),true);assert.equal(await page.evaluate(()=>document.body.classList.contains('viewport-fullscreen-active')),true);await page.locator('#a-assets-close').click();await page.locator('.viewport-fullscreen-button').click();await page.waitForFunction(()=>!document.body.classList.contains('viewport-fullscreen-active'));assert.deepEqual(await recipe(),before);
 });
 await run('Saved action persists through real reload and reopens without an AI model',async()=>{
  await page.reload();await page.waitForFunction(()=>threeLab?.state.assets>=3);await page.locator('.primary-nav [data-view="actions"]').click();await page.waitForFunction(()=>threeLab.state.action?.active);await choose(savedActionId,'discard');assert.deepEqual(await recipe(),savedRecipe);assert.equal(await page.evaluate(()=>__assetAnimation.calls.length),0);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,'action-assets-desktop-internal.png'),fullPage:true});
 });
 await run('Asset handoffs preserve the original static GLB bytes and metadata',async()=>assert.deepEqual((await readRecords()).find(r=>r.asset.id===originalId),originalRecord));
 await run('No uncaught browser errors or unexpected network access',()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
 await saveReport({passed:true});console.log(`${checks.length} Action Lab asset browser checks passed.`);
}catch(error){await page.screenshot({path:path.join(output,'failure-internal.png'),fullPage:true}).catch(()=>{});await saveReport({passed:false,failure:error.stack});throw error;}
finally{await context.close();await browser.close();}
