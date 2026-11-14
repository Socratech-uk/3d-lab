/** Built app regression. Controlled replies verify wiring, not neural motion quality. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.resolve(process.env.TEST_OUTPUT||path.join(root,'test-output','flow-prompts'));
await fs.mkdir(output,{recursive:true});
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
const {chromium}=process.env.PLAYWRIGHT_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href):await import('playwright');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,...(process.env.CHROMIUM_PATH?{LD_LIBRARY_PATH:path.dirname(process.env.CHROMIUM_PATH)}:{})}});
const context=await browser.newContext({viewport:{width:1536,height:1000},acceptDownloads:true});
const checks=[],errors=[],network=[];
await context.route('**/*',route=>{if(route.request().url()==='https://action-prompts.test/')return route.fulfill({contentType:'text/html',body:html});network.push(route.request().url());return route.abort();});
await context.addInitScript(()=>{
 const fixture=window.__expansionModel={loaded:null,calls:[],renderCount:0,failAt:0,hold:false,release:null};
 const client={status:async()=>({models:['unimate','momask','unirig'].map(id=>({id,name:id,available:true,loaded:fixture.loaded===id}))}),
 prepare:async o=>{fixture.calls.push({op:'prepare',model:o.model});fixture.loaded=o.model;return {deviceName:'Controlled browser fixture'};},
 render:async o=>{fixture.calls.push({op:'render',model:o.model,prompt:o.prompt,durationSeconds:o.durationSeconds,seed:o.seed});fixture.renderCount++;if(fixture.failAt===fixture.renderCount)throw Error('Controlled second-action failure');if(fixture.hold)await new Promise(resolve=>fixture.release=resolve);
  if(o.model==='unirig')return {skeleton:structuredClone(fixture.skeleton)};
  const pending=[...o.skeleton],ordered=[];while(pending.length){const i=pending.findIndex(j=>j.parent===null||ordered.some(p=>p.id===j.parent));if(i<0)throw Error('Fixture needs connected rig');ordered.push(...pending.splice(i,1));}
  const joints=ordered.map(j=>({name:j.name,parent:ordered.findIndex(v=>v.id===j.parent),position:[...j.position]})),fps=30,count=Math.ceil(o.durationSeconds*fps)+1;
  return {motion:{format:'capp.motion.v1',fps,durationSeconds:o.durationSeconds,joints,frames:Array.from({length:count},(_,i)=>({time:i===count-1?o.durationSeconds:i/fps,positions:joints.map(j=>[j.position[0],j.position[1],j.position[2]+i/fps*.1]),rotations:joints.map(()=>[0,0,0,1])})),provenance:{fixture:true}}};},
 cancel:async()=>{fixture.loaded=null;fixture.release?.();return {cancelled:true};},unload:async()=>{fixture.calls.push({op:'unload'});fixture.loaded=null;return {};},dispose:()=>{}};
 window.capp={ai:{local:{animation:{connect:()=>client}}}};
});
const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const run=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const storedPrompts=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('capp.3d-lab.action-prompts.v1')));
const flow=()=>page.evaluate(()=>threeLab.actions.getWorkflow());
const actions=async()=>(await flow()).nodes.find(n=>n.type==='motions').config.actions;
const tab=async name=>page.locator(`[data-action-tab="${name}"]`).click();
const openBatch=async()=>{await tab('flow');await page.locator('#af-open').click();const node=(await flow()).nodes.find(n=>n.type==='motions');await page.locator(`[data-af-node="${node.id}"]`).click();};
const change=async(selector,value)=>{await page.locator(selector).fill(value);await page.locator(selector).dispatchEvent('change');};
const download=async selector=>{const pending=page.waitForEvent('download');await page.locator(selector).click();return fs.readFile(await(await pending).path());};
const report=async extra=>fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,network,builtIndexSha256:createHash('sha256').update(html).digest('hex'),inferenceVerified:false,nativeVerified:false,...extra},null,2));
let saved,original,snapshot,exported;
try{
 await page.goto('https://action-prompts.test/');await page.locator('.primary-nav [data-view="actions"]').click();await page.waitForFunction(()=>threeLab.actions&&threeLab.state.action?.joints.length===21);
 await run('prompt saved in the already-open Action Lab appears immediately in the workflow picker',async()=>{
  await tab('motion');await page.locator('.action-prompt-library > summary').click();
  await page.locator('#a-ai-prompt-name').fill('My guard recipe');await page.locator('#a-ai-action-name').fill('Guard patrol');await page.locator('#a-ai-prompt').fill('A person walks slowly.\nLook ahead.');await page.locator('#a-ai-duration').fill('6.017');await page.locator('.action-ai-advanced > summary').click();await page.locator('#a-ai-seed').fill('73');await page.locator('#a-ai-save-prompt').click();
  saved=(await storedPrompts()).entries.find(p=>p.name==='My guard recipe');assert.ok(saved);original=structuredClone(saved);
  await openBatch();const before=(await actions()).length;await page.locator('#af-add-action').click();assert.equal((await actions()).length,before,'Opening a picker must not append a generic action');
  const mainOptions=await page.locator('#a-ai-preset option').evaluateAll(list=>list.map(e=>[e.value,e.textContent]));const pickerOptions=await page.locator('#af-prompt-choice option').evaluateAll(list=>list.map(e=>[e.value,e.textContent]));assert.deepEqual(pickerOptions.slice(1),mainOptions.slice(1));
  await page.locator('#af-prompt-choice').selectOption('saved:'+saved.id);assert.equal(await page.locator('#af-prompt-duration').inputValue(),'6.017');assert.equal(await page.locator('#af-prompt-seed').inputValue(),'73');await page.locator('#af-prompt-add').click();
  snapshot=(await actions()).at(-1);assert.deepEqual(snapshot,{name:'Guard patrol',prompt:saved.prompt,durationSeconds:6.017,seed:73,loop:false});assert.deepEqual((await storedPrompts()).entries.find(p=>p.id===saved.id),original);
 });
 await run('starter selection and replacement use real recipes without requiring prompt entry',async()=>{
  await page.locator('#af-add-action').click();await page.locator('#af-prompt-choice').selectOption('preset:human-wave');await page.locator('#af-prompt-add').click();let rows=await actions(),index=rows.length-1;assert.deepEqual(rows[index],{name:'Wave',prompt:'A person waves.',durationSeconds:2,seed:0,loop:false});
  const row=page.locator(`[data-af-row="${index}"]`);assert.equal(await row.locator('.af-action-custom').getAttribute('open'),null);await row.locator('[data-af-action-field="loop"]').check();await row.locator('[data-af-replace-action]').click();await page.locator('#af-prompt-choice').selectOption('preset:human-jump');await page.locator('#af-prompt-add').click();rows=await actions();assert.equal(rows[index].name,'Jump');assert.equal(rows[index].prompt,'A person jumps.');assert.equal(rows[index].loop,true,'Replacing a recipe must preserve the workflow loop choice');
  await row.locator('.af-action-custom > summary').click();await change(`[data-af-row="${index}"] [data-af-action-field="prompt"]`,'A person jumps gently.');assert.equal((await actions())[index].prompt,'A person jumps gently.');assert.deepEqual((await storedPrompts()).entries.find(p=>p.id===saved.id),original);
  await page.locator('#af-add-action').click();await page.locator('#af-prompt-choice').selectOption('saved:'+saved.id);await page.screenshot({path:path.join(output,'picker-desktop.png')});await page.locator('#af-prompt-cancel').click();
 });
 await run('live saved-prompt updates refresh the picker while existing workflow copies are retained',async()=>{
  await page.locator('#af-close').click();await tab('motion');await page.locator('#a-ai-duration').fill('12');await page.locator('#a-ai-prompt').fill('A person patrols slowly.');await page.locator('#a-ai-update-prompt').click();assert.equal((await storedPrompts()).entries.find(p=>p.id===saved.id).durationSeconds,12);
  await openBatch();assert.deepEqual((await actions())[2],snapshot);await page.locator('#af-add-action').click();await page.locator('#af-prompt-choice').selectOption('saved:'+saved.id);assert.equal(await page.locator('#af-prompt-duration').inputValue(),'12');
  await page.locator('[data-af-config="model"]').selectOption('momask');assert.equal(await page.locator('#af-prompt-add').isDisabled(),true);assert.match(await page.locator('#af-prompt-hint').textContent(),/9.6/);await page.locator('#af-prompt-duration').fill('9.6');await page.locator('#af-prompt-seed').fill('91');assert.equal(await page.locator('#af-prompt-add').isEnabled(),true);await page.locator('#af-prompt-add').click();
  assert.equal((await actions()).at(-1).durationSeconds,9.6);assert.equal((await actions()).at(-1).seed,91);assert.equal((await storedPrompts()).entries.find(p=>p.id===saved.id).durationSeconds,12);
 });
 await run('deleting a source does not change exported or saved workflow actions',async()=>{
  const before=await actions();await page.locator('#af-close').click();await tab('motion');await page.locator('#a-ai-delete-prompt').click();assert.equal((await storedPrompts()).entries.some(p=>p.id===saved.id),false);
  await openBatch();assert.deepEqual(await actions(),before);await page.locator('#af-add-action').click();assert.equal(await page.locator(`#af-prompt-choice option[value="saved:${saved.id}"]`).count(),0);await page.locator('#af-prompt-cancel').click();await change('#af-name','Shared prompts regression');await page.locator('#af-save-plan').click();exported=JSON.parse(await download('#af-export'));assert.deepEqual(exported.nodes.find(n=>n.type==='motions').config.actions,before);assert.equal(exported.policy,undefined);
  await page.reload();await page.waitForFunction(()=>window.threeLab?.actions);await page.locator('.primary-nav [data-view="actions"]').click();await openBatch();await page.locator('#af-saved').selectOption({label:'Shared prompts regression'});await page.locator('#af-load').click();assert.deepEqual(await actions(),before);
 });
 await run('picked recipe reaches the engine with its exact seed and duration, then pauses for review',async()=>{
  await page.locator('#af-close').click();await tab('body');await page.locator('#a-body-reviewed').check();await page.locator('#a-body-use').click();
  const nodes=[{id:'current',type:'current',config:{}},{id:'motions',type:'motions',config:{model:'unimate',actions:[snapshot]}},{id:'review',type:'review',config:{}}];const plan={format:'capp.action-flow',version:1,name:'Picked recipe run',nodes,edges:[{from:'current',to:'motions'},{from:'motions',to:'review'}]};await page.evaluate(value=>threeLab.actions.setWorkflow(value),plan);await openBatch();await page.locator('[data-af-license="unimate"]').check();await page.locator('#af-run').click();await page.waitForFunction(()=>threeLab.actions.flow.status==='paused');
  const calls=await page.evaluate(()=>__expansionModel.calls.filter(c=>c.op==='render'));assert.equal(calls.length,1);assert.deepEqual(calls[0],{op:'render',model:'unimate',prompt:snapshot.prompt,durationSeconds:6.017,seed:73});
  const clip=await page.evaluate(()=>threeLab.actions.recipe.clips.at(-1));assert.equal(clip.name,'Guard patrol');assert.equal(clip.duration,6.017);assert.equal(clip.loop,false);await page.locator('[data-af-node="motions"]').click();assert.equal(await page.locator('#af-add-action').isDisabled(),true);await page.locator('#af-cancel').click();assert.equal(await page.locator('#af-add-action').isEnabled(),true);
 });
 await run('picker respects the action limit and fits a phone viewport',async()=>{
  const plan=await flow();plan.nodes.find(n=>n.type==='motions').config.actions=Array.from({length:32},(_,i)=>({...snapshot,name:'Patrol '+i}));await page.evaluate(value=>threeLab.actions.setWorkflow(value),plan);await page.locator('[data-af-node="motions"]').click();assert.equal(await page.locator('#af-add-action').isDisabled(),true);
  plan.nodes.find(n=>n.type==='motions').config.actions=[snapshot];await page.evaluate(value=>threeLab.actions.setWorkflow(value),plan);await page.locator('[data-af-node="motions"]').click();assert.equal(await page.locator('[data-af-remove-action]').isDisabled(),true);await page.setViewportSize({width:390,height:844});await page.locator('#af-add-action').click();await page.locator('#af-prompt-choice').selectOption('preset:human-wave');await page.locator('#af-prompt-choice').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.equal(await page.locator('#af-inspector').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await page.screenshot({path:path.join(output,'picker-mobile.png')});
 });
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await report({success:true});
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});await report({success:false,error:error.stack});throw error;}finally{await browser.close();}
