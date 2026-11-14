// Real built Lab, both real Local AI facades and real disk workers.
// Native IPC, CUDA inference and the folder picker are controlled doubles.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {inspectGlb} from '../src/core.mjs';
import {fixtureGlb} from './fixtures.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const capp=process.env.CAPP_ROOT||path.resolve(root,'../capp');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'hunyuan-controls-browser-'));
const env={...process.env,USERPROFILE:tmp+'/user',LOCALAPPDATA:tmp+'/settings',CAPP_ASSETS_ROOT:''};
const validBytes=await fs.readFile(root+'/tests/fixtures/trimesh-4.0.5-finite-normal.glb'),brokenBytes=await fs.readFile(root+'/tests/fixtures/trimesh-4.0.5-zero-normal.glb');
const encoded=validBytes.toString('base64'),brokenEncoded=brokenBytes.toString('base64');
const [html,ownerFacade,appFacade]=await Promise.all([fs.readFile(root+'/index.html','utf8'),fs.readFile(capp+'/sidecars/local-ai/runtime/local-models3d.js','utf8'),fs.readFile(capp+'/sidecars/local-ai/runtime/local-ai-app-bridge.js','utf8')]);
const execute=payload=>new Promise((resolve,reject)=>{
 const child=spawn('python3',['-B',capp+'/sidecars/files/native/worker.py'],{env,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>{if(code)return reject(Error(err));try{resolve(JSON.parse(out));}catch(e){reject(Error(out+' '+err));}});child.stdin.end(JSON.stringify(payload));
});
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PATH||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,LD_LIBRARY_PATH:path.dirname(process.env.CHROMIUM_PATH)}});
const errors=[],plan={app:{id:'3d-lab'},library:{selected:[{id:'uk.capp.sidecar.local-ai'}]}};
const childPrefix=`<script>window.__CAPP_PACKAGED_RUNTIME__=true;window.__CAPP_EXECUTABLE_PLAN__=${JSON.stringify(plan)};window.capp={files:{protocol:'capp.files.v1',async request(value){const reply=await parent.__filesInvoke(value);if(!reply.ok){const e=Error(reply.error);e.status=reply.status;throw e;}return reply.result;}}};parent.__CAPP_ATTACH_LOCAL_AI_APP__(window);<\/script>`;
const childHTML=html.replace('<head>','<head>'+childPrefix);
async function boot(){
 const context=await browser.newContext({viewport:{width:1920,height:1035}}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.exposeFunction('__filesInvoke',execute);
 await page.route('https://hunyuan.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden}body{display:grid;grid-template-rows:40px minmax(0,1fr)}iframe{display:block;width:100%;height:100%;border:0}header{background:#13212e;color:white;font:13px system-ui;padding:10px}</style></head><body><header>cApp host fixture</header><iframe id="appFrame"></iframe></body></html>'}));
 await page.goto('https://hunyuan.test/');
 await page.evaluate(({plan,encoded,brokenEncoded})=>{
  window.__CAPP_EXECUTABLE_PLAN__=plan;window.__shapeCalls=[];window.__encoded=encoded;window.__brokenEncoded=brokenEncoded;window.__outputMode='invalid';
  window.cappLocalAiNative={async models3d(text){const v=JSON.parse(text);window.__shapeCalls.push(v);if(v.op==='status')return JSON.stringify({ok:true,supported:true,permitted:true,engineInstalled:true,models:['triposr','triposg','hunyuan3d-2mini','hunyuan3d-2','hunyuan3d-2mv','hunyuan3d-2.1'].map(id=>({id,available:true,downloaded:true,loaded:false}))});if(v.op==='render')return JSON.stringify({ok:true,...v,modelGlb:window.__outputMode==='invalid'?window.__brokenEncoded:window.__encoded,deviceName:'Controlled IPC output',generationMs:1,conditioning:{processorSize:512,imagePadding:v.imagePadding,views:[{view:'front',width:64,height:64},{view:'left',width:64,height:64}],surfaceExtractor:'marching-cubes',geometryPostprocessing:'none'}});return JSON.stringify({ok:true,...v,prepared:true,loaded:true});}};
 },{plan,encoded,brokenEncoded});
 await page.addScriptTag({content:ownerFacade});await page.addScriptTag({content:appFacade});
 await page.evaluate(()=>{window.__localApi={};const options={api:window.__localApi,getConfig:()=>({allowAppModels3d:true,applicationAccess:'scoped'}),getIdentity:()=>({id:'3d-lab'})};window.__CAPP_INSTALL_LOCAL_MODELS3D__(options);window.__CAPP_INSTALL_LOCAL_AI_APP_BRIDGE__(options);});
 await page.evaluate(value=>document.getElementById('appFrame').srcdoc=value,childHTML);
 await page.waitForFunction(()=>appFrame.contentWindow.threeLab&&appFrame.contentDocument.getElementById('asset-storage-open')?.dataset.state==='ready');
 return {page,context,frame:page.frameLocator('#appFrame')};
}
const output=path.resolve(process.env.TEST_OUTPUT||root+'/test-output/glb-layout-zoom');
await fs.mkdir(output,{recursive:true});
let page,context,frame;const checks=[],layouts=[];
const test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const fitted=async(label)=>{
 const layout=await page.evaluate(()=>{
  const w=appFrame.contentWindow,d=appFrame.contentDocument,rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
  return {view:w.threeLab.state.view,height:w.innerHeight,width:w.innerWidth,documentHeight:d.documentElement.scrollHeight,documentWidth:d.documentElement.scrollWidth,stage:rect(d.querySelector('.stage-panel')),viewport:rect(d.getElementById('viewport')),fit:rect(d.getElementById('fit-view'))};
 });
 assert.ok(layout.documentHeight<=layout.height+1,JSON.stringify(layout));assert.ok(layout.documentWidth<=layout.width+1,JSON.stringify(layout));
 for(const r of [layout.stage,layout.viewport,layout.fit]){assert.ok(r.y>=-1&&r.x>=-1&&r.bottom<=layout.height+1&&r.right<=layout.width+1,JSON.stringify(layout));}
 assert.ok(layout.viewport.width>100&&layout.viewport.height>80,JSON.stringify(layout));layouts.push({label,...layout});
};
try{
 ({page,context,frame}=await boot());
 await test('long generation panels scroll independently while Create fits desktop and laptop windows',async()=>{
  await frame.locator('#model').selectOption('hunyuan3d-2mv');
  for(const [width,height] of [[1920,1035],[1366,768],[1280,720],[1024,768]]){
   await page.setViewportSize({width,height});await fitted('Create '+width+'x'+height);
   const before=await frame.locator('.stage-panel').boundingBox();await frame.locator('#generate').scrollIntoViewIfNeeded();const after=await frame.locator('.stage-panel').boundingBox();assert.equal(after.y,before.y);assert.equal(after.height,before.height);
   assert.ok(await frame.locator('.create-panel').evaluate(e=>e.scrollHeight>e.clientHeight));
  }
  await page.setViewportSize({width:1920,height:1035});await page.screenshot({path:output+'/create-desktop.png'});
 });
 const image=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(8,8,48,48);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await frame.locator('#image-input').setInputFiles({name:'front.png',mimeType:'image/png',buffer:image});
 for(const view of ['left','right','back'])await frame.locator('#view-'+view+'-input').setInputFiles({name:view+'.png',mimeType:'image/png',buffer:image});
 await frame.locator('#new-title').fill('Export regression');await frame.locator('#steps').fill('75');await frame.locator('#resolution').selectOption('512');await frame.locator('.engine-details summary').click();await frame.locator('#accept-license').check();await frame.locator('#prepare-model').click();await page.waitForFunction(()=>__shapeCalls.some(v=>v.op==='prepare')&&!appFrame.contentWindow.threeLab.state.busy);
 await test('the exact legacy exporter failure retains downloadable bytes and cannot write an invalid draft',async()=>{
  await frame.locator('#generate').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.retained&&!appFrame.contentWindow.threeLab.state.busy);
  assert.equal(await page.evaluate(()=>appFrame.contentWindow.threeLab.state.assets),0);assert.equal(await frame.locator('#retry-save').isDisabled(),true);assert.match(await frame.locator('#retained-title').innerText(),/could not be opened/);
  const pending=page.waitForEvent('download');await frame.locator('#download-retained').click();const d=await pending;assert.deepEqual(await fs.readFile(await d.path()),brokenBytes);
  await frame.locator('#discard-retained').click();assert.equal(await page.evaluate(()=>appFrame.contentWindow.threeLab.state.retained),false);assert.equal(await frame.locator('#generate').isEnabled(),true);
 });
 let savedId;
 await test('the finite-normal export passes both real facades, saves to disk and renders after 75-step settings',async()=>{
  await page.evaluate(()=>window.__outputMode='valid');await frame.locator('#generate').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.assets===1&&!!appFrame.contentWindow.threeLab.state.selected&&!appFrame.contentWindow.threeLab.state.busy);
  savedId=await page.evaluate(()=>appFrame.contentWindow.threeLab.state.selected);const disk=await execute({service:'model',route:'assets/'+savedId}),blob=disk.result.bundle.files.glb.$blob;assert.equal(blob.sha256,hash(validBytes));
  const cat=JSON.parse(await fs.readFile(tmp+'/user/cApp/assets/3d/catalogue.json','utf8'));assert.equal(cat.assets[savedId].asset.recipe.steps,75);assert.equal(cat.assets[savedId].asset.triangles,1);assert.equal(await frame.locator('#inspector-content').isVisible(),true);await fitted('Generated Create');
  await page.screenshot({path:output+'/create-generated.png'});
 });
 await test('Ctrl+wheel leaves the 3D camera alone and remains uncancelled for native page zoom',async()=>{
  const before=await page.evaluate(()=>appFrame.contentWindow.threeLab.state.builder.viewer.camera);
  const result=await frame.locator('#viewport canvas').evaluate(canvas=>{const e=new WheelEvent('wheel',{deltaY:120,ctrlKey:true,bubbles:true,cancelable:true});canvas.dispatchEvent(e);return e.defaultPrevented;});
  assert.equal(result,false);assert.deepEqual(await page.evaluate(()=>appFrame.contentWindow.threeLab.state.builder.viewer.camera),before);
  const normal=await frame.locator('#viewport canvas').evaluate(canvas=>{const e=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});canvas.dispatchEvent(e);return e.defaultPrevented;});assert.equal(normal,true);assert.notDeepEqual(await page.evaluate(()=>appFrame.contentWindow.threeLab.state.builder.viewer.camera),before);
 });
 await test('Builder, Shape Lab and Action Lab keep the preview within the desktop workspace',async()=>{
  await frame.locator('#edit-builder').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.view==='builder');
  for(const [width,height] of [[1920,1035],[1366,768],[1024,768]]){await page.setViewportSize({width,height});await fitted('Builder '+width+'x'+height);}
  await frame.locator('.primary-nav [data-view="shapes"]').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.view==='shapes');await fitted('Shape Lab');
  const cancelled=await frame.locator('.shape-canvas-wrap canvas').evaluate(canvas=>{const e=new WheelEvent('wheel',{deltaY:120,ctrlKey:true,bubbles:true,cancelable:true});canvas.dispatchEvent(e);return e.defaultPrevented;});assert.equal(cancelled,false);
  await frame.locator('.primary-nav [data-view="create"]').click();await frame.locator('#edit-action').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.view==='actions');await fitted('Action Lab');await page.screenshot({path:output+'/action-laptop.png'});
 });
 await test('small screens show the complete Create preview before the controls without horizontal overflow',async()=>{
  await frame.locator('.primary-nav [data-view="create"]').click();
  for(const [width,height] of [[390,844],[820,1180]]){await page.setViewportSize({width,height});const bounds=await frame.locator('.stage-panel').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height+1);assert.equal(await page.evaluate(()=>appFrame.contentDocument.documentElement.scrollWidth<=appFrame.contentWindow.innerWidth+1),true);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/create-mobile.png'});
 });
 await test('a fresh browser profile reopens the fixed generation from disk',async()=>{
  await context.close();({page,context,frame}=await boot());await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.assets===1);
  await frame.locator('.primary-nav [data-view="assets"]').click();await frame.locator('.asset-card[data-asset="'+savedId+'"]').dblclick();await page.waitForFunction(id=>appFrame.contentWindow.threeLab.state.selected===id,savedId);assert.match(await frame.locator('#mesh-summary').innerText(),/1 triangles/);await fitted('Reopened Create');await context.close();
 });
 assert.deepEqual(errors,[]);await fs.writeFile(output+'/result.json',JSON.stringify({ok:true,checks,layouts,errors,neuralInference:false,nativeWindowsZoom:false},null,2)+'\n');
}catch(error){await page?.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});await fs.writeFile(output+'/failure.json',JSON.stringify({message:error.message,checks,layouts,errors},null,2));throw error;}
finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true});}

