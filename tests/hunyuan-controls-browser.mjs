// Real built Lab, both real Local AI facades and real disk workers.
// Native IPC, CUDA inference and the folder picker are controlled doubles.
import assert from 'node:assert/strict';
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
const encoded=Buffer.from(fixtureGlb()).toString('base64');
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
 const context=await browser.newContext({viewport:{width:1536,height:1050}}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.exposeFunction('__filesInvoke',execute);
 await page.route('https://hunyuan.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"><iframe id="appFrame" style="width:100vw;height:100vh;border:0"></iframe></body></html>'}));
 await page.goto('https://hunyuan.test/');
 await page.evaluate(({plan,encoded})=>{
  window.__CAPP_EXECUTABLE_PLAN__=plan;window.__shapeCalls=[];window.__encoded=encoded;
  window.cappLocalAiNative={async models3d(text){const v=JSON.parse(text);window.__shapeCalls.push(v);if(v.op==='status')return JSON.stringify({ok:true,supported:true,permitted:true,engineInstalled:true,models:['triposr','triposg','hunyuan3d-2mini','hunyuan3d-2','hunyuan3d-2mv','hunyuan3d-2.1'].map(id=>({id,available:true,downloaded:true,loaded:false}))});if(v.op==='render')return JSON.stringify({ok:true,...v,modelGlb:window.__encoded,deviceName:'Controlled IPC output',generationMs:1,conditioning:{processorSize:512,imagePadding:v.imagePadding,views:[{view:'front',width:64,height:64},{view:'left',width:64,height:64}],surfaceExtractor:'marching-cubes',geometryPostprocessing:'none'}});return JSON.stringify({ok:true,...v,prepared:true,loaded:true});}};
 },{plan,encoded});
 await page.addScriptTag({content:ownerFacade});await page.addScriptTag({content:appFacade});
 await page.evaluate(()=>{window.__localApi={};const options={api:window.__localApi,getConfig:()=>({allowAppModels3d:true,applicationAccess:'scoped'}),getIdentity:()=>({id:'3d-lab'})};window.__CAPP_INSTALL_LOCAL_MODELS3D__(options);window.__CAPP_INSTALL_LOCAL_AI_APP_BRIDGE__(options);});
 await page.evaluate(value=>document.getElementById('appFrame').srcdoc=value,childHTML);
 await page.waitForFunction(()=>appFrame.contentWindow.threeLab&&appFrame.contentDocument.getElementById('asset-storage-open')?.dataset.state==='ready');
 return {page,context,frame:page.frameLocator('#appFrame')};
}
try{
 let {page,context,frame}=await boot();
 assert.deepEqual(await frame.locator('#resolution option').evaluateAll(nodes=>nodes.map(n=>n.value)),['128','256']);
 await frame.locator('#model').selectOption('hunyuan3d-2mv');assert.equal(await frame.locator('#hunyuan-settings').isVisible(),true);
 assert.deepEqual(await frame.locator('#resolution option').evaluateAll(nodes=>nodes.map(n=>n.value)),['128','256','384','512']);
 const image=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(8,8,48,48);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await frame.locator('#image-input').setInputFiles({name:'front.png',mimeType:'image/png',buffer:image});
 await frame.locator('#view-left-input').setInputFiles({name:'left.png',mimeType:'image/png',buffer:image});
 await frame.locator('#new-title').fill('Hunyuan detail fixture');
 for(const [id,value] of [['resolution','512'],['memory-mode','cpu-offload'],['image-padding','0.05']])await frame.locator('#'+id).selectOption(value);
 for(const [id,value] of [['seed','23'],['steps','75'],['guidance-scale','6.5'],['num-chunks','4000']])await frame.locator('#'+id).fill(value);
 await frame.locator('.engine-details summary').click();await frame.locator('#accept-license').check();await frame.locator('#prepare-model').click();
 await page.waitForFunction(()=>__shapeCalls.some(v=>v.op==='prepare')&&!appFrame.contentWindow.threeLab.state.busy);
 assert.equal((await page.evaluate(()=>__shapeCalls.find(v=>v.op==='prepare'))).memoryMode,'cpu-offload');
 await frame.locator('#generate').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.assets===1&&appFrame.contentWindow.threeLab.state.selected&&!appFrame.contentWindow.threeLab.state.assetLoading&&appFrame.contentDocument.getElementById('storage-status').textContent==='Drafts on disk');
 const submitted=await page.evaluate(()=>__shapeCalls.find(v=>v.op==='render'));
 const expected={model:'hunyuan3d-2mv',device:'auto',resolution:512,seed:23,steps:75,guidanceScale:6.5,memoryMode:'cpu-offload',numChunks:4000,imagePadding:.05};
 for(const [key,value] of Object.entries(expected))assert.equal(submitted[key],value,key);
 const catalogue=JSON.parse(await fs.readFile(tmp+'/user/cApp/assets/3d/catalogue.json','utf8'));
 const entry=Object.values(catalogue.assets)[0];assert.deepEqual(entry.asset.recipe,expected);assert.equal(entry.asset.result.conditioning.processorSize,512);assert.deepEqual(entry.asset.result.conditioning.views.map(v=>v.view),['front','left']);const disk=await execute({service:'model',route:'assets/'+entry.asset.id});assert.ok(disk.result.bundle.files.views.left);
 assert.match(await frame.locator('#asset-stats').innerText(),/CPU offload/);
 console.log('PASS built Hunyuan controls pass both real facades and save their confirmed recipe to the real shared disk catalogue');
 await context.close();({page,context,frame}=await boot());await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.assets===1);
 await frame.locator('.primary-nav [data-view="assets"]').click();
 await frame.locator('.asset-card').first().click({button:'right'});
 await frame.locator('#context-menu [data-action="reference"]').click();
 await page.waitForFunction(()=>appFrame.contentDocument.getElementById('new-title').value.includes('variation'));
 for(const [id,value] of [['model',expected.model],['resolution','512'],['seed','23'],['steps','75'],['guidance-scale','6.5'],['memory-mode','cpu-offload'],['num-chunks','4000'],['image-padding','0.05']])assert.equal(await frame.locator('#'+id).inputValue(),value,id);
 assert.equal(await frame.locator('#view-left-name').innerText(),'left.png');
 await frame.locator('#resolution').selectOption('384');await frame.locator('#guidance-scale').fill('0');await frame.locator('#steps').fill('50');await frame.locator('#num-chunks').fill('2000');
 await frame.locator('#generate').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.assets===2&&!appFrame.contentWindow.threeLab.state.busy);
 const variant=await page.evaluate(()=>__shapeCalls.find(v=>v.op==='render'));assert.equal(variant.resolution,384);assert.equal(variant.guidanceScale,0);assert.equal(variant.steps,50);assert.equal(variant.numChunks,2000);
 console.log('PASS an empty browser profile reopens the disk draft, restores all controls/references, and generates a 384 variation with zero guidance');
 await frame.locator('#model').selectOption('triposr');assert.equal(await frame.locator('#hunyuan-settings').isVisible(),false);assert.deepEqual(await frame.locator('#resolution option').evaluateAll(nodes=>nodes.map(n=>n.value)),['128','256']);assert.equal(await frame.locator('#resolution').inputValue(),'256');
 console.log('PASS switching models restores the correct detail limits');
 await frame.locator('.primary-nav [data-view="assets"]').click();await frame.locator('.asset-card[data-asset="'+entry.asset.id+'"]').click({button:'right'});await frame.locator('#context-menu [data-action="builder"]').click();await page.waitForFunction(()=>appFrame.contentWindow.threeLab.state.view==='builder'&&appFrame.contentWindow.threeLab.state.builder.active);
 await frame.locator('[data-tool-tab="texture"]').click();assert.equal(await frame.locator('#b-bake-all').isChecked(),true);await frame.locator('#b-bake-size').selectOption('1024');await frame.locator('#b-bake').click();await page.waitForFunction(()=>!appFrame.contentWindow.threeLab.state.builder.busy&&appFrame.contentWindow.threeLab.state.builder.history===1);
 const pending=page.waitForEvent('download');await frame.locator('#b-download').click();const downloaded=await pending,painted=inspectGlb(await fs.readFile(await downloaded.path()));assert.equal(painted.triangles,4);const bakeNode=painted.json.nodes.find(n=>n.extras?.builderSourceTexture);assert.deepEqual(bakeNode.extras.builderSourceTexture.views,['front','left']);assert.ok(painted.json.images.length);
 console.log('PASS the actual Builder bakes every retained multiview reference into an embedded atlas without extra triangles');
 const replacement=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');g.fillStyle='#00ff00';g.fillRect(0,0,64,64);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await frame.locator('#b-projection').selectOption('left');await frame.locator('#b-image-input').setInputFiles({name:'Replacement left.png',mimeType:'image/png',buffer:replacement});await page.waitForFunction(()=>!appFrame.contentWindow.threeLab.state.builder.busy&&appFrame.contentDocument.getElementById('b-reference-name').textContent.includes('Replacement'));
 await frame.locator('#b-bake').click();await page.waitForFunction(()=>!appFrame.contentWindow.threeLab.state.builder.busy&&appFrame.contentWindow.threeLab.state.builder.history===2);await frame.locator('#b-save').click();await page.waitForFunction(()=>!appFrame.contentWindow.threeLab.state.builder.busy&&!appFrame.contentWindow.threeLab.state.builder.dirty&&appFrame.contentWindow.threeLab.state.assets===3);
 const after=JSON.parse(await fs.readFile(tmp+'/user/cApp/assets/3d/catalogue.json','utf8')),edited=Object.values(after.assets).find(v=>v.asset.origin==='edit');assert.equal(edited.asset.source.sha256,entry.asset.source.sha256);const editedBundle=(await execute({service:'model',route:'assets/'+edited.asset.id})).result.bundle;assert.equal(editedBundle.files.views.left.name,'Replacement left.png');assert.notEqual(editedBundle.files.views.left.sha256,disk.result.bundle.files.views.left.sha256);
 assert.deepEqual(errors,[]);console.log('PASS saving a replacement side reference retains the original front, correct view role and source draft');
 await context.close();
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true});}
