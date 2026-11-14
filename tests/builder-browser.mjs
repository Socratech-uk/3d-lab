import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectGlb } from '../src/core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const playwrightPath = process.env.PLAYWRIGHT_PATH || path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright/index.mjs');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const chromiumPath=process.env.CHROMIUM_PATH || '/tmp/chromium';
const output=process.env.TEST_OUTPUT || path.join(root,'test-output','builder');await fs.mkdir(output,{recursive:true});
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
const browser=await chromium.launch({executablePath:chromiumPath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,LD_LIBRARY_PATH:path.dirname(chromiumPath)}});
const results=[],errors=[],network=[],skipped=[],dialogs=[];const contexts=[];
const test=async(name,fn)=>{const start=Date.now();await fn();results.push({name,ms:Date.now()-start});console.log('PASS',name);};
const state=page=>page.evaluate(()=>window.threeLab.state);
async function readyPage(){const context=await browser.newContext({viewport:{width:1512,height:982},acceptDownloads:true});contexts.push(context);await context.route('**/*',route=>{if(route.request().url()==='https://3dlab-builder.test/')return route.fulfill({status:200,contentType:'text/html',body:html});network.push(route.request().url());return route.abort();});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept();});await page.goto('https://3dlab-builder.test/');await page.waitForFunction(()=>window.threeLab?.state);return page;}
async function importModel(page,bytes,name){const before=(await state(page)).assets;await page.locator('#glb-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer:Buffer.from(bytes)});await page.waitForFunction(n=>window.threeLab.state.assets===n+1&&!!window.threeLab.state.selected,before);return (await state(page)).selected;}
async function enter(page){await page.locator('.primary-nav [data-view="builder"]').click();await page.waitForFunction(()=>window.threeLab.state.view==='builder'&&window.threeLab.state.builder.active&&!window.threeLab.state.builder.busy);}
async function act(page,id){await page.locator('#'+id).click();await page.waitForFunction(()=>!window.threeLab.state.builder.busy);}
async function download(page,id='b-download'){const pending=page.waitForEvent('download');await page.locator('#'+id).click();const downloaded=await pending;const bytes=await fs.readFile(await downloaded.path());await page.waitForFunction(()=>!window.threeLab.state.builder?.busy);return bytes;}
async function openCard(page,id){await page.locator('.primary-nav [data-view="assets"]').click();await page.locator(`.asset-card[data-asset="${id}"]`).dblclick();await page.waitForFunction(id=>window.threeLab.state.view==='create'&&window.threeLab.state.selected===id,id);}
function geometryDigest(bytes){const {json}=inspectGlb(new Uint8Array(bytes));const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const binaryStart=28+view.getUint32(12,true);const hash=createHash('sha256');for(const mesh of json.meshes)for(const primitive of mesh.primitives){for(const index of [primitive.attributes.POSITION,primitive.indices].filter(n=>n!==undefined)){const accessor=json.accessors[index],buffer=json.bufferViews[accessor.bufferView],begin=binaryStart+(buffer.byteOffset||0)+(accessor.byteOffset||0);const size=accessor.count*(accessor.type==='VEC3'?3:1)*({5121:1,5123:2,5125:4,5126:4}[accessor.componentType]);hash.update(bytes.subarray(begin,begin+size));}}return hash.digest('hex');}
function cubeGlb(){
 const face=(a,b,c,d)=>[...a,...b,...c,...a,...c,...d];
 const positions=new Float32Array([
  ...face([-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]),...face([1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]),
  ...face([1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]),...face([-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]),
  ...face([-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]),...face([-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1])]);
 const json={asset:{version:'2.0',generator:'3D Lab synthetic Builder fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},mode:4}]}],buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:36,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]}]};
 const encoded=new TextEncoder().encode(JSON.stringify(json)),padded=Math.ceil(encoded.length/4)*4,bytes=new Uint8Array(28+padded+positions.byteLength),view=new DataView(bytes.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);view.setUint32(12,padded,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+padded);bytes.set(encoded,20);view.setUint32(20+padded,positions.byteLength,true);view.setUint32(24+padded,0x004e4942,true);bytes.set(new Uint8Array(positions.buffer),28+padded);return bytes;
}

function geometrySummary(bytes) {
  const {json,triangles}=inspectGlb(new Uint8Array(bytes)),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),binaryStart=28+view.getUint32(12,true);
  const read=(accessorId,index,channel=0)=>{
    const a=json.accessors[accessorId],b=json.bufferViews[a.bufferView],components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},size=sizes[a.componentType];
    const byte=binaryStart+(b.byteOffset||0)+(a.byteOffset||0)+index*(b.byteStride||components*size)+channel*size;
    const getter={5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[a.componentType];return view[getter](byte,true);
  };
  const meshes=json.meshes.map(mesh=>{
    let area=0,volume=0;
    for(const primitive of mesh.primitives){const position=primitive.attributes.POSITION,count=primitive.indices===undefined?json.accessors[position].count:json.accessors[primitive.indices].count;
      for(let i=0;i<count;i+=3){const points=[0,1,2].map(k=>{const n=primitive.indices===undefined?i+k:read(primitive.indices,i+k);return[0,1,2].map(c=>read(position,n,c));}),ab=points[1].map((v,k)=>v-points[0][k]),ac=points[2].map((v,k)=>v-points[0][k]);area+=Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])/2;const [a,b,c]=points;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
    } return {name:mesh.name,area,volume};
  });
  return {json,triangles,meshes,area:meshes.reduce((sum,m)=>sum+m.area,0),volume:meshes.reduce((sum,m)=>sum+m.volume,0)};
}
async function canvasPoint(page,x=.5,y=.5){const box=await page.locator('#viewport canvas').boundingBox();assert.ok(box,'viewport canvas is visible');return{x:box.x+box.width*x,y:box.y+box.height*y};}
async function front(page){if(await page.locator('#dismiss-notice').isVisible())await page.locator('#dismiss-notice').click();await page.locator('#front-view').click();}
async function moveOver(page,x=.5,y=.5){const p=await canvasPoint(page,x,y);await page.mouse.move(p.x,p.y);}
async function clickSurface(page,x,y){const p=await canvasPoint(page,x,y);await page.mouse.click(p.x,p.y);}
async function holdKey(page,key,ms=180){await page.keyboard.down(key);await page.waitForTimeout(ms);await page.keyboard.up(key);}
async function sourceCopy(page){await page.locator('.primary-nav [data-view="assets"]').click();await enter(page);await front(page);}
async function storedAsset(page,id){return page.evaluate(id=>new Promise((resolve,reject)=>{const r=indexedDB.open('capp.3d-lab.assets.v1');r.onsuccess=()=>{const db=r.result,tx=db.transaction('assets'),q=tx.objectStore('assets').get(id);q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=()=>reject(q.error);};}),id);}

// Scenarios follow after the Builder UI is integrated. All mutation paths use the public UI.
async function outline(page,{left=.44,right=.56,top=.43,bottom=.57,aside=false}={}) {
 await page.locator('[data-tool-tab="cut"]').click();
 await page.locator('#b-cut-aside').setChecked(aside);
 await page.locator('#b-cut-depth').fill('.25');
 await front(page);
 for(const [x,y] of [[left,top],[right,top],[right,bottom],[left,bottom]])await clickSurface(page,x,y);
 await page.waitForFunction(()=>window.threeLab.state.builder.outlinePoints===4);
}
async function selectPart(page,index=0){await page.locator('#b-object-list [role="option"]').nth(index).click();}
async function freshOriginal(page,id){await openCard(page,id);await enter(page);await front(page);}
try {
 const page=await readyPage(),cube=cubeGlb();let originalId,baseline,cutDigest;
 await test('cube import and Builder preserve twelve source triangles',async()=>{originalId=await importModel(page,cube,'Builder cube.glb');await enter(page);assert.equal((await state(page)).builder.triangles,12);assert.equal(await page.locator('#viewport canvas').count(),1);baseline=geometryDigest(await download(page));});
 await test('outline cursor tracks the surface and four clicked points draw a pending cut',async()=>{
  await page.locator('[data-tool-tab="cut"]').click();await front(page);await moveOver(page);
  await page.waitForFunction(()=>window.threeLab.state.builder.viewer.cursorVisible);
  await outline(page);const s=await state(page);assert.equal(s.builder.pending,true);assert.equal(s.builder.outlinePoints,4);assert.match(await page.locator('#b-outline-progress').textContent(),/4 points/);assert.equal(s.builder.triangles,12);
  await page.screenshot({path:path.join(output,'outline-tracking.png'),fullPage:true});
 });
 await test('drawing an outline locks movement and permits point correction',async()=>{
  const before=(await state(page)).builder.viewer.camera;await page.locator('#viewport canvas').focus();await holdKey(page,'w');assert.deepEqual((await state(page)).builder.viewer.camera,before);
  await page.keyboard.press('Backspace');await page.waitForFunction(()=>window.threeLab.state.builder.outlinePoints===3);await clickSurface(page,.44,.57);assert.equal((await state(page)).builder.outlinePoints,4);
 });
 await test('point outline separates a complementary new object and Undo/Redo preserve geometry',async()=>{
  await act(page,'b-cut');const s=await state(page),exported=await download(page),info=geometrySummary(exported);assert.equal(s.builder.parts.length,2);assert.equal(s.builder.pending,false);assert.equal(info.meshes.length,2);assert.ok(info.meshes.every(m=>m.area>0));assert.ok(Math.abs(info.area-24)<1e-4,`surface area ${info.area}`);assert.ok(info.json.nodes.some(m=>m.name?.includes('cut piece')));cutDigest=geometryDigest(exported);
  assert.notEqual(cutDigest,baseline);await act(page,'b-undo');assert.equal((await state(page)).builder.parts.length,1);assert.equal(geometryDigest(await download(page)),baseline);await act(page,'b-redo');assert.equal(geometryDigest(await download(page)),cutDigest);
 });
 await test('inner walls can be generated on the outlined hull with the extracted piece retained',async()=>{
  await selectPart(page,0);await page.locator('[data-tool-tab="interior"]').click();await page.locator('#b-thickness').fill('.05');await act(page,'b-shell');assert.match(await page.locator('#notice-text').textContent(),/inner walls.*applied/i);const info=geometrySummary(await download(page));assert.equal(info.meshes.length,2);assert.ok((await state(page)).builder.triangles>12);
  await act(page,'b-floor-preset');await act(page,'b-part');assert.equal((await state(page)).builder.parts.length,3);
 });
 await test('a cut made after inner-wall generation retains closed separated wall geometry',async()=>{
  await freshOriginal(page,originalId);await page.locator('[data-tool-tab="interior"]').click();await page.locator('#b-thickness').fill('.05');await act(page,'b-shell');const before=geometrySummary(await download(page));assert.ok(before.volume>0);
  await outline(page);await act(page,'b-cut');const after=geometrySummary(await download(page));assert.equal(after.meshes.length,2);assert.ok(after.meshes.every(m=>m.volume>0));assert.ok(Math.abs(after.volume-before.volume)<1e-4,`wall volume ${after.volume} != ${before.volume}`);
 });
 await test('discard restores the exact original and unfinished outlines trigger navigation confirmation',async()=>{
  await freshOriginal(page,originalId);assert.equal(geometryDigest(await download(page)),baseline);await page.locator('[data-tool-tab="cut"]').click();await clickSurface(page,.46,.46);assert.equal((await state(page)).builder.pending,true);
  const before=dialogs.length;await page.locator('.primary-nav [data-view="assets"]').click();assert.equal(dialogs.length,before+1);assert.match(dialogs.at(-1),/outline|unfinished|unsaved|discard/i);await enter(page);assert.equal((await state(page)).builder.pending,false);assert.equal(geometryDigest(await download(page)),baseline);
 });
 await test('existing outline points drag without completing and clicking the first point closes the cut',async()=>{
  await outline(page);const first=await canvasPoint(page,.44,.43),moved=await canvasPoint(page,.41,.44);await page.mouse.move(first.x,first.y);await page.mouse.down();await page.mouse.move(moved.x,moved.y,{steps:5});await page.mouse.up();assert.equal((await state(page)).builder.outlinePoints,4);assert.equal((await state(page)).builder.parts.length,1);
  await clickSurface(page,.41,.44);await page.waitForFunction(()=>!window.threeLab.state.builder.busy&&window.threeLab.state.builder.parts.length===2);assert.equal((await state(page)).builder.pending,false);await freshOriginal(page,originalId);
 });
 await test('Move gizmo dragging commits baked geometry and Undo restores the source',async()=>{
  await page.locator('[data-workspace-tool="translate"]').click();await page.waitForFunction(()=>!window.threeLab.state.builder.busy);const center=await canvasPoint(page);await page.mouse.move(center.x+40,center.y);await page.mouse.down();await page.mouse.move(center.x+100,center.y,{steps:8});await page.mouse.up();await page.waitForFunction(()=>window.threeLab.state.builder.history===1);assert.notEqual(geometryDigest(await download(page)),baseline);await act(page,'b-undo');assert.equal(geometryDigest(await download(page)),baseline);await freshOriginal(page,originalId);
 });
 await test('cancelling a Move gizmo drag restores geometry and leaves no undo entry',async()=>{
  await page.locator('[data-workspace-tool="translate"]').click();await page.waitForFunction(()=>!window.threeLab.state.builder.busy);const center=await canvasPoint(page);await page.mouse.move(center.x+40,center.y);await page.mouse.down();await page.mouse.move(center.x+100,center.y,{steps:8});await page.locator('#viewport canvas').evaluate(canvas=>canvas.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'mouse',bubbles:true,cancelable:true})));await page.mouse.up();assert.equal((await state(page)).builder.history,0);assert.equal((await state(page)).builder.dirty,false);assert.equal(geometryDigest(await download(page)),baseline);await freshOriginal(page,originalId);
 });
 await test('floating toolbar selects Move and pending outlines refuse tool changes safely',async()=>{
  await page.locator('[data-workspace-tool="translate"]').click();await page.waitForFunction(()=>!window.threeLab.state.builder.busy);assert.equal((await state(page)).builder.tool,'translate');await page.locator('[data-workspace-tool="cut"]').click();await page.waitForFunction(()=>!window.threeLab.state.builder.busy);await front(page);await clickSurface(page,.46,.46);
  await page.locator('[data-workspace-tool="translate"]').click();await page.waitForFunction(()=>!window.threeLab.state.builder.busy);assert.equal((await state(page)).builder.tool,'cut');assert.equal((await state(page)).builder.outlinePoints,1);assert.match(await page.locator('#notice-text').textContent(),/finish|cancel/i);await page.locator('#viewport canvas').focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.threeLab.state.builder.pending&&!window.threeLab.state.builder.busy);
 });
 await test('visible sculpt footprint edits by direct drag as one undoable stroke',async()=>{
  await page.locator('[data-tool-tab="sculpt"]').click();await page.locator('#b-brush').selectOption('inflate');await page.locator('#b-radius').fill('3');await front(page);await moveOver(page);await page.waitForFunction(()=>window.threeLab.state.builder.viewer.brushVisible);
  const start=await canvasPoint(page),end=await canvasPoint(page,.51,.51);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:3});await page.mouse.up();await page.waitForFunction(()=>window.threeLab.state.builder.history===1);
  assert.equal((await state(page)).builder.dirty,true);assert.notEqual(geometryDigest(await download(page)),baseline);await act(page,'b-undo');assert.equal(geometryDigest(await download(page)),baseline);
 });
 await test('cancelling an in-progress brush stroke restores geometry without adding history',async()=>{
  await front(page);await moveOver(page);const p=await canvasPoint(page);await page.mouse.down();await page.mouse.move(p.x+10,p.y+8,{steps:3});await page.locator('#viewport canvas').evaluate(canvas=>canvas.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'mouse',bubbles:true,cancelable:true})));await page.mouse.up();assert.equal((await state(page)).builder.history,0);assert.equal((await state(page)).builder.dirty,false);assert.equal(geometryDigest(await download(page)),baseline);
 });
 await test('numeric object transforms, duplication, locking and object search work together',async()=>{
  await page.locator('[data-tool-tab="objects"]').click();await page.locator('#b-move-x').fill('.4');await act(page,'b-transform');assert.notEqual(geometryDigest(await download(page)),baseline);await act(page,'b-duplicate');assert.equal((await state(page)).builder.parts.length,2);
  await page.locator('#b-object-name').fill('Window spare');await act(page,'b-rename');await page.locator('#b-object-search').fill('Window');assert.equal(await page.locator('#b-object-list [role="option"]').count(),1);await page.locator('#b-object-search').fill('');
  await act(page,'b-lock');const before=geometryDigest(await download(page));await act(page,'b-transform');assert.match(await page.locator('#notice-text').textContent(),/lock/i);assert.equal(geometryDigest(await download(page)),before);assert.ok((await state(page)).builder.parts.some(p=>p.locked));
 });
 await test('hidden and locked scene objects persist through save and reopen',async()=>{
  await act(page,'b-hide');const prior=(await state(page)).builder.parts;assert.ok(prior.some(p=>!p.visible&&p.locked));const exported=geometrySummary(await download(page));assert.equal(exported.meshes.length,2);assert.ok(exported.json.nodes.some(n=>n.extras?.builderHidden&&n.extras?.builderLocked));
  await page.locator('#b-title').fill('Hidden locked scene');await act(page,'b-save');const saved=(await state(page)).selected;assert.notEqual(saved,originalId);assert.equal((await storedAsset(page,saved)).edit.parentId,originalId);await page.reload();await page.waitForFunction(()=>window.threeLab?.state.assets===2);await openCard(page,saved);await enter(page);const parts=(await state(page)).builder.parts;assert.equal(parts.length,2);assert.ok(parts.some(p=>!p.visible&&p.locked));
 });
 await test('WASD and QE move the focused viewport while text inputs keep typing safely',async()=>{
  await freshOriginal(page,originalId);await page.locator('#viewport canvas').focus();const start=(await state(page)).builder.viewer;await holdKey(page,'w');const moved=(await state(page)).builder.viewer;assert.notDeepEqual(moved.camera,start.camera);await holdKey(page,'q');const rotated=(await state(page)).builder.viewer;assert.notDeepEqual(rotated.target,moved.target);
  await page.locator('#b-title').fill('Keyboard');const before=(await state(page)).builder.viewer.camera;await page.locator('#b-title').press('w');assert.deepEqual((await state(page)).builder.viewer.camera,before);assert.equal(await page.locator('#b-title').inputValue(),'Keyboardw');await front(page);
 });
 await test('fullscreen retains tool, object and keyboard-guide access',async()=>{
  await page.locator('.viewport-fullscreen-button').click();await page.waitForFunction(()=>!!document.fullscreenElement||!!document.querySelector('.viewport-expanded'));
  await page.locator('.viewport-tool-button[data-workspace-tool="cut"]').click();await page.waitForFunction(()=>!window.threeLab.state.builder.busy);assert.equal((await state(page)).builder.tool,'cut');await page.getByRole('button',{name:'Toggle tool settings',exact:true}).click();assert.equal(await page.locator('#b-cut-depth').isVisible(),true);await page.getByRole('button',{name:'Close workspace side panel',exact:true}).click();
  await page.getByRole('button',{name:'Toggle scene objects',exact:true}).click();assert.equal(await page.locator('#b-object-list').isVisible(),true);await page.getByRole('button',{name:'Close workspace side panel',exact:true}).click();
  await page.getByRole('button',{name:'Keyboard and mouse guide (?)',exact:true}).click();assert.equal(await page.locator('.viewport-keyboard-help').isVisible(),true);await page.getByRole('button',{name:'Close keyboard guide',exact:true}).click();await page.screenshot({path:path.join(output,'fullscreen-workspace.png'),fullPage:true});await page.locator('.viewport-fullscreen-button').click();await page.waitForFunction(()=>!document.fullscreenElement&&!document.querySelector('.viewport-expanded'));
 });
 await test('manual and automatic graphics recovery preserve edits, object state and one canvas',async()=>{
  await page.locator('[data-tool-tab="geometry"]').click();await act(page,'b-clean');const before=geometryDigest(await download(page)),prior=(await state(page)).builder;
  await page.evaluate(()=>document.querySelector('#viewport canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());await page.locator('#recover-viewer').waitFor({state:'visible'});await page.locator('#recover-viewer').click();await page.locator('#viewer-failure').waitFor({state:'hidden'});assert.equal(await page.locator('#viewport canvas').count(),1);assert.equal(geometryDigest(await download(page)),before);assert.equal((await state(page)).builder.history,prior.history);
  await page.evaluate(()=>{window.testLossExtension=document.querySelector('#viewport canvas').getContext('webgl2').getExtension('WEBGL_lose_context');window.testLossExtension.loseContext();});await page.locator('#recover-viewer').waitFor({state:'visible'});await page.evaluate(()=>window.testLossExtension.restoreContext());await page.locator('#viewer-failure').waitFor({state:'hidden'});assert.equal(geometryDigest(await download(page)),before);assert.equal((await state(page)).builder.history,prior.history);
 });
 await test('failed edited-draft save preserves working geometry and download',async()=>{
  const before=await state(page),bytes=geometryDigest(await download(page));await page.evaluate(()=>{const add=IDBObjectStore.prototype.add;window.restoreTestAdd=()=>IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.add=function(value,...args){if(this.name==='files')throw new DOMException('Injected full storage','QuotaExceededError');return add.call(this,value,...args);};});
  try{await act(page,'b-save');assert.equal((await state(page)).assets,before.assets);assert.equal((await state(page)).builder.dirty,true);assert.equal(geometryDigest(await download(page)),bytes);}finally{await page.evaluate(()=>window.restoreTestAdd());}
 });
 await test('original GLB remains byte-for-byte unchanged',async()=>{await openCard(page,originalId);assert.deepEqual(await download(page,'download-glb'),Buffer.from(cube));await enter(page);});
 await test('desktop and mobile Builder layouts fit without horizontal overflow',async()=>{for(const width of[1512,1024,768,390]){await page.setViewportSize({width,height:982});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`width ${width}`);if(width===390)await page.screenshot({path:path.join(output,'builder-mobile.png'),fullPage:true});}await page.setViewportSize({width:1512,height:982});await page.screenshot({path:path.join(output,'builder-desktop.png'),fullPage:true});});
 await test('no unexpected external requests or uncaught browser errors',async()=>{assert.deepEqual(network,[]);assert.deepEqual(errors,[]);});
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks:results.length,results,errors,network,scope:'Integrated browser editor tests using synthetic meshes and real UI events. No neural generation, Windows packaging or GPU inference.'},null,2));console.log(`${results.length} integrated Builder browser checks passed.`);
} catch(error) {
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify({checks:results.length,results,error:error.stack,errors,network},null,2));for(const context of contexts)for(const page of context.pages())await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;
} finally {for(const context of contexts)await context.close();await browser.close();}
