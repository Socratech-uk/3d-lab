/** Built editor, real WebGL/IndexedDB/GLB. Controlled model replies test orchestration only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.resolve(process.env.TEST_OUTPUT||path.join(root,'test-output','expansion'));
await fs.mkdir(output,{recursive:true});
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
const {chromium}=process.env.PLAYWRIGHT_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href):await import('playwright');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,...(process.env.CHROMIUM_PATH?{LD_LIBRARY_PATH:path.dirname(process.env.CHROMIUM_PATH)}:{})}});
const context=await browser.newContext({viewport:{width:1536,height:1000},acceptDownloads:true});
const checks=[],errors=[],network=[];
await context.route('**/*',route=>{if(route.request().url()==='https://action-expansion.test/')return route.fulfill({contentType:'text/html',body:html});network.push(route.request().url());return route.abort();});
await context.addInitScript(()=>{
 const fixture=window.__expansionModel={loaded:null,calls:[],renderCount:0,failAt:0,hold:false,release:null};
 const client={status:async()=>({models:['unimate','momask','unirig'].map(id=>({id,name:id,available:true,loaded:fixture.loaded===id}))}),
 prepare:async o=>{fixture.calls.push({op:'prepare',model:o.model});fixture.loaded=o.model;return {deviceName:'Controlled browser fixture'};},
 render:async o=>{fixture.calls.push({op:'render',model:o.model,prompt:o.prompt});fixture.renderCount++;if(fixture.failAt===fixture.renderCount)throw Error('Controlled second-action failure');if(fixture.hold)await new Promise(resolve=>fixture.release=resolve);
  if(o.model==='unirig')return {skeleton:structuredClone(fixture.skeleton)};
  const pending=[...o.skeleton],ordered=[];while(pending.length){const i=pending.findIndex(j=>j.parent===null||ordered.some(p=>p.id===j.parent));if(i<0)throw Error('Fixture needs connected rig');ordered.push(...pending.splice(i,1));}
  const joints=ordered.map(j=>({name:j.name,parent:ordered.findIndex(v=>v.id===j.parent),position:[...j.position]})),fps=30,count=Math.ceil(o.durationSeconds*fps)+1;
  return {motion:{format:'capp.motion.v1',fps,durationSeconds:o.durationSeconds,joints,frames:Array.from({length:count},(_,i)=>({time:i===count-1?o.durationSeconds:i/fps,positions:joints.map(j=>[j.position[0],j.position[1],j.position[2]+i/fps*.1]),rotations:joints.map(()=>[0,0,0,1])})),provenance:{fixture:true}}};},
 cancel:async()=>{fixture.loaded=null;fixture.release?.();return {cancelled:true};},unload:async()=>{fixture.calls.push({op:'unload'});fixture.loaded=null;return {};},dispose:()=>{}};
 window.capp={ai:{local:{animation:{connect:()=>client}}}};
});
const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const run=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const recipe=()=>page.evaluate(()=>threeLab.actions.recipe);
const state=()=>page.evaluate(()=>threeLab.state.action);
const rounded=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Number(v.toFixed(10)):v));
const same=(a,b)=>assert.deepEqual(rounded(a),rounded(b));
const download=async selector=>{const pending=page.waitForEvent('download');await page.locator(selector).click();return fs.readFile(await(await pending).path());};
const tab=async name=>page.locator(`[data-action-tab="${name}"]`).click();
const plan=(nodes,name='Browser test flow')=>({format:'capp.action-flow',version:1,name,nodes:nodes.map((n,i)=>({id:'step-'+i,type:n.type,label:n.type,position:{x:40+i*260,y:60},config:n.config||{}})),edges:nodes.slice(1).map((_,i)=>({from:'step-'+i,to:'step-'+(i+1)}))});
const resetCapture=()=>page.evaluate(()=>{scrollTo(0,0);const dialog=document.getElementById('af-editor');if(dialog?.open)dialog.scrollTop=0;});
const report=async extra=>fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,network,builtIndexSha256:createHash('sha256').update(html).digest('hex'),inferenceVerified:false,nativeVerified:false,...extra},null,2));
let savedId,savedRecipe;
try{
 await page.goto('https://action-expansion.test/');await page.locator('.primary-nav [data-view="actions"]').click();await page.waitForFunction(()=>threeLab.actions&&threeLab.state.action?.joints.length===21);
 await run('new navigation exposes equipment, reusable rig shelf and workflow editor',async()=>{for(const name of ['equipment','reuse','flow'])assert.equal(await page.locator(`[data-action-tab="${name}"]`).isVisible(),true);assert.equal(await page.locator('#a-send-foundry').isVisible(),true);});
 await run('reviewed body map enables grip prediction and four per-weapon actions',async()=>{
  await tab('body');await page.locator('#a-body-reviewed').check();await page.locator('#a-body-use').click();await tab('equipment');
  const before=await recipe();await page.locator('#ae-category').selectOption('rifle');await page.locator('#ae-add').click();await page.locator('#ae-name').fill('Patrol rifle');await page.locator('#ae-predict').click();await page.locator('#ae-build-set').click();
  const doc=await recipe(),item=doc.equipment.items[0];assert.equal(item.name,'Patrol rifle');assert.ok(item.sockets.grip&&item.sockets.support&&item.sockets.holster);assert.equal(Object.keys(item.actions).length,4);assert.equal(doc.clips.length,before.clips.length+4);same(doc.joints,before.joints);same(doc.bindings,before.bindings);assert.ok(doc.equipment.events.some(e=>e.state==='held'));assert.ok(doc.clips.find(c=>c.id===item.actions.hold).tracks[item.sockets.grip.joint].length>10);
  await resetCapture();await page.screenshot({path:path.join(output,'equipment-desktop.png'),fullPage:false});
 });
 await run('weight admission is enforced and undo restores the whole item operation',async()=>{
  const before=await recipe();const failure=await page.evaluate(()=>{try{threeLab.actions.addEquipment({category:'carry',name:'Too heavy',massKg:30,carryLimitKg:25,actions:['hold']});return null;}catch(e){return e.message;}});assert.match(failure,/carrying limit/);same(await recipe(),before);
  await page.evaluate(()=>threeLab.actions.addEquipment({category:'carry',name:'Supply crate',massKg:8,dimensions:[.5,.4,.4],actions:['hold']}));const added=await recipe();assert.equal(added.equipment.items.length,2);assert.ok(added.equipment.items[1].sockets.support);await page.locator('#a-undo').click();same(await recipe(),before);
 });
 await run('GLB embeds equipment and actions while preserving the original skinned mesh',async()=>{
  const doc=await recipe(),bytes=await download('#a-export'),glb=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString().trim());const embedded=glb.nodes.find(n=>n.extras?.cappActionDocument)?.extras.cappActionDocument;same(embedded,doc);assert.equal(glb.skins[0].joints.length,21);assert.equal(glb.animations.length,4);assert.equal(glb.meshes.length,Object.keys(doc.bindings).length);await fs.writeFile(path.join(output,'equipment-character.glb'),bytes);await fs.writeFile(path.join(output,'equipment-character.recipe.json'),JSON.stringify({format:'capp.movement-pack',actionDocument:doc}));
 });
 await run('rig shelf reuses a named action and saves the recipe independently of the scene',async()=>{
  await tab('reuse');await page.locator('#ar-name').fill('Patrol shared humanoid');await page.locator('#ar-save').click();await page.waitForFunction(()=>document.getElementById('ar-recipe').value&&!document.getElementById('ar-reuse').disabled);assert.match(await page.locator('#ar-summary').textContent(),/21 joints/);
  const before=await recipe();await page.locator('#ar-speed').fill('0.8');await page.locator('#ar-action-name').fill('Patrol slower equip');await page.locator('#ar-reuse').click();const after=await recipe();assert.equal(after.clips.length,before.clips.length+1);same(after.joints,before.joints);same(after.bindings,before.bindings);assert.equal(after.clips.at(-1).name,'Patrol slower equip');assert.ok(Math.abs(after.clips.at(-1).duration-before.clips.find(c=>c.id===before.equipment.items[0].actions.equip).duration/.8)<1e-9);await page.locator('#a-undo').click();same(await recipe(),before);
  assert.equal(await page.locator('#ar-fit').isDisabled(),true);await page.locator('#ar-replace').check();await page.locator('#ar-fit').click();assert.equal((await recipe()).clips.length,1);assert.equal((await recipe()).equipment,undefined);await page.locator('#a-undo').click();same(await recipe(),before);await resetCapture();await page.screenshot({path:path.join(output,'rig-shelf-desktop.png'),fullPage:false});
 });
 await run('node editor adds, edits, connects and drags actual portable workflow nodes',async()=>{
  await page.evaluate(flow=>threeLab.actions.setWorkflow(flow),plan([{type:'current'},{type:'review'}],'Graph UI study'));await tab('flow');await page.locator('#af-open').click();await page.locator('#af-add-type').selectOption('equipment');await page.locator('#af-add').click();
  let flow=await page.evaluate(()=>threeLab.actions.getWorkflow());assert.equal(flow.nodes.length,3);assert.equal(flow.edges.length,2);const item=flow.nodes.find(n=>n.type==='equipment');await page.locator('[data-af-config="name"]').fill('Graph cargo');await page.locator('[data-af-config="name"]').dispatchEvent('change');flow=await page.evaluate(()=>threeLab.actions.getWorkflow());assert.equal(flow.nodes.find(n=>n.id===item.id).config.name,'Graph cargo');
  await page.locator('#af-disconnect').click();assert.equal((await page.evaluate(()=>threeLab.actions.getWorkflow())).edges.length,1);await page.locator('#af-connect-to').selectOption('step-1');await page.locator('#af-connect').click();assert.equal((await page.evaluate(()=>threeLab.actions.getWorkflow())).edges.length,2);
  const header=page.locator(`[data-af-node="${item.id}"] .af-node-drag`);await header.scrollIntoViewIfNeeded();const box=await header.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+65,{steps:6});await page.mouse.up();const moved=(await page.evaluate(()=>threeLab.actions.getWorkflow())).nodes.find(n=>n.id===item.id);assert.ok(moved.position.y>item.position.y);
  await page.locator('#af-auto-joints').check();await page.locator('#af-save-plan').click();const exported=JSON.parse(await download('#af-export'));assert.equal(exported.name,'Graph UI study');assert.equal(exported.policy,undefined);assert.equal(exported.nodes.find(n=>n.id===item.id).config.name,'Graph cargo');await resetCapture();await page.screenshot({path:path.join(output,'workflow-editor-desktop.png'),fullPage:false});await page.locator('#af-close').click();
 });
 await run('workflow pauses for review before saving a real equipment character draft',async()=>{
  const flow=plan([{type:'current'},{type:'equipment',config:{category:'pistol',name:'Sidearm',massKg:1,dimensions:[.05,.18,.23],actions:['equip','hold','holster']}},{type:'review'},{type:'save',config:{name:'Equipment workflow reviewed'}}]);await page.evaluate(flow=>threeLab.actions.setWorkflow(flow),flow);const count=await page.evaluate(()=>threeLab.state.assets);const result=await page.evaluate(()=>threeLab.actions.runWorkflow({}));assert.equal(result.status,'paused');assert.equal(await page.evaluate(()=>threeLab.state.assets),count);assert.equal((await recipe()).equipment.items.length,2);
  await page.evaluate(()=>threeLab.actions.openWorkflow());await resetCapture();await page.screenshot({path:path.join(output,'workflow-review-desktop.png'),fullPage:false});await page.evaluate(()=>threeLab.actions.resumeWorkflow());await page.waitForFunction(()=>threeLab.actions.flow.status==='completed'&&!threeLab.state.action.busy);assert.equal(await page.evaluate(()=>threeLab.state.assets),count+1);savedId=(await state()).source.id;savedRecipe=await recipe();assert.equal(savedRecipe.title,'Equipment workflow reviewed');
 });
 await run('batch retry keeps successful clips and retries only the failed model action',async()=>{
  await page.evaluate(()=>threeLab.actions.cancelWorkflow());const flow=plan([{type:'current'},{type:'motions',config:{model:'unimate',actions:[{name:'Batch first',prompt:'A person stands.',durationSeconds:1,seed:1,loop:true},{name:'Batch second',prompt:'A person steps.',durationSeconds:1,seed:2,loop:false}],unloadAfter:true}},{type:'review'}]);await page.evaluate(flow=>threeLab.actions.setWorkflow(flow),flow);await page.evaluate(()=>{__expansionModel.failAt=2;__expansionModel.renderCount=0;});const before=(await recipe()).clips.length;const failed=await page.evaluate(()=>threeLab.actions.runWorkflow({acceptedModels:['unimate']}));assert.equal(failed.status,'failed');assert.equal((await recipe()).clips.length,before+1);const retried=await page.evaluate(()=>threeLab.actions.retryWorkflow());assert.equal(retried.status,'paused');const after=await recipe();assert.equal(after.clips.length,before+2);assert.equal(after.clips.filter(c=>c.name==='Batch first').length,1);assert.equal(after.clips.filter(c=>c.name==='Batch second').length,1);assert.equal(await page.evaluate(()=>__expansionModel.renderCount),3);assert.equal(await page.evaluate(()=>__expansionModel.loaded),null);await page.evaluate(()=>threeLab.actions.cancelWorkflow());
 });
 await run('predicted joints, reviewed body roles and smooth weights can run automatically before mandatory review',async()=>{
  const before=await recipe();await page.evaluate(doc=>{__expansionModel.failAt=0;__expansionModel.skeleton={format:'capp.skeleton.v1',joints:doc.joints.map(j=>({name:j.name,parent:doc.joints.findIndex(p=>p.id===j.parent),position:j.position}))};},before);
  const flow=plan([{type:'current'},{type:'predict',config:{unloadAfter:true}},{type:'accept'},{type:'bind'},{type:'review'}]);await page.evaluate(flow=>threeLab.actions.setWorkflow(flow),flow);const result=await page.evaluate(()=>threeLab.actions.runWorkflow({acceptedModels:['unirig'],autoApplyJoints:true,autoBindWeights:true}));assert.equal(result.status,'paused');assert.equal(result.nodeId,'step-4');const after=await recipe();assert.equal(after.joints.length,21);assert.ok(after.bodyMap.signature);assert.equal((await state()).skeletonCandidate,false);assert.equal(Object.keys(after.bindings).length,Object.keys(before.bindings).length);assert.ok(Object.values(after.bindings).every(b=>b.mode==='skin'));assert.equal(after.clips.length,1);assert.equal(await page.evaluate(()=>__expansionModel.loaded),null);await page.evaluate(()=>threeLab.actions.cancelWorkflow());
 });
 await run('mobile editor panels stay within the viewport',async()=>{
  if(await page.locator('#af-editor').isVisible())await page.locator('#af-close').click();await page.setViewportSize({width:390,height:844});for(const name of ['equipment','reuse','flow']){await tab(name);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Page overflow in '+name);}await page.screenshot({path:path.join(output,'workflow-mobile.png'),fullPage:true});await page.setViewportSize({width:1536,height:1000});
 });
 await run('saved equipment draft and reusable shelf survive a browser reload',async()=>{
  await page.reload();await page.waitForFunction(()=>window.threeLab?.actions);await page.locator('.primary-nav [data-view="actions"]').click();const open=page.evaluate(id=>threeLab.actions.open(id),savedId);await page.locator('#action-switch-discard').click();await open;await page.waitForFunction(id=>threeLab.state.action.source.id===id,savedId);same(await recipe(),savedRecipe);await tab('reuse');await page.waitForFunction(()=>document.getElementById('ar-recipe').value);assert.match(await page.locator('#ar-summary').textContent(),/21 joints/);
 });
 await run('no unhandled browser errors or network requests',async()=>{same(errors,[]);same(network,[]);});
 await report({success:true});
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await report({success:false,error:error.stack});throw error;}finally{await browser.close();}
