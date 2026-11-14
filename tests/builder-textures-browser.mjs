// Built application, real PNG/GLB codecs and temporary on-disk assets.
// No neural inference, native build or installed GPU acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three-0.160.1/build/three.module.js';
import {packGlb} from './fixtures.mjs';
import {inspectGlb} from '../src/core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.resolve(process.env.TEST_OUTPUT||root+'/test-output/textures');await fs.mkdir(output,{recursive:true});
const disk=await fs.mkdtemp(path.join(os.tmpdir(),'builder-textures-')),html=await fs.readFile(root+'/index.html');
const hash=value=>createHash('sha256').update(value).digest('hex'),checks=[],errors=[];
const test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const cube=new THREE.BoxGeometry(2,2,2).toNonIndexed(),positions=cube.attributes.position.array;
const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,name:'Cube'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[-1,-1,-1],max:[1,1,1]}]};
const bytes=packGlb(json,new Uint8Array(positions.buffer));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/',service=spawn('python3',[root+'/tools/asset_storage.py','--root',disk,'--port','0'],{stdio:['ignore','pipe','pipe']});
const link=await new Promise((resolve,reject)=>{let stdout='',stderr='';service.stderr.on('data',b=>stderr+=b);service.once('exit',c=>reject(Error('Disk fixture exited '+c+' '+stderr)));service.stdout.on('data',b=>{stdout+=b;const match=stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#storage=[A-Za-z0-9_-]+/);if(match)resolve(match[0]);});});
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PATH||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,LD_LIBRARY_PATH:path.dirname(process.env.CHROMIUM_PATH)}});
const context=await browser.newContext({viewport:{width:1536,height:1050},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const connect=async p=>{await p.locator('#asset-storage-open').click();await p.getByText('Advanced · remote storage',{exact:true}).click();await p.locator('#storage-link').fill(link);await p.locator('#storage-connect').click();await p.waitForFunction(()=>document.getElementById('storage-authoring').textContent.includes('are saved on disk'));await p.locator('#storage-close').click();};
async function model(id){const catalogue=JSON.parse(await fs.readFile(disk+'/catalogue.json','utf8')),folder=disk+'/drafts/'+id+'/'+catalogue.assets[id].fingerprint;return fs.readFile(folder+'/model.glb');}
async function act(id){await page.locator('#'+id).click();await page.waitForFunction(()=>!threeLab.state.builder.busy);}
async function download(){const pending=page.waitForEvent('download');await page.locator('#b-download').click();const d=await pending,result=await fs.readFile(await d.path());await page.waitForFunction(()=>!threeLab.state.builder.busy);inspectGlb(result);return result;}
async function importModel(data,name){const previous=await page.evaluate(()=>threeLab.state.selected),before=await page.evaluate(()=>threeLab.state.assets);await page.locator('#glb-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer:Buffer.from(data)});await page.waitForFunction(({before,previous,title})=>threeLab.state.assets===before+1&&threeLab.state.selected!==previous&&!threeLab.state.assetLoading&&document.getElementById('notice-text').textContent.includes('Imported “'+title+'”'),{before,previous,title:name.replace(/\.glb$/i,'')});await page.locator('#edit-builder').click();await page.waitForFunction(()=>threeLab.state.builder.active&&threeLab.state.view==='builder');return page.evaluate(()=>threeLab.state.selected);}
function geometrySignature(data){
 const j=inspectGlb(data).json,view=new DataView(data.buffer,data.byteOffset,data.byteLength),binary=28+view.getUint32(12,true),rows=[];
 const read=(id,i,c=0)=>{const a=j.accessors[id],b=j.bufferViews[a.bufferView],n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],size=a.componentType===5123?2:4,at=binary+(b.byteOffset||0)+(a.byteOffset||0)+i*(b.byteStride||n*size)+c*size;return view[a.componentType===5126?'getFloat32':a.componentType===5123?'getUint16':'getUint32'](at,true);};
 for(const m of j.meshes)for(const p of m.primitives){const n=j.accessors[p.indices??p.attributes.POSITION].count;for(let i=0;i<n;i+=3){const row=[];for(let k=0;k<3;k++){const id=p.indices===undefined?i+k:read(p.indices,i+k);for(let c=0;c<3;c++)row.push(read(p.attributes.POSITION,id,c));}rows.push(JSON.stringify(row));}}
 return hash(rows.sort().join('\n'));
}
let sourceId,editedId,baked;
try {
 await page.goto(url);await page.waitForFunction(()=>window.threeLab);await connect(page);sourceId=await importModel(bytes,'Texture fixture.glb');
 const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');for(const [x,y,colour] of [[0,0,'#ff0000'],[64,0,'#00ff00'],[0,64,'#0000ff'],[64,64,'#ffff00']]){g.fillStyle=colour;g.fillRect(x,y,64,64);}return c.toDataURL('image/png').split(',')[1];}),'base64');
 await page.locator('[data-tool-tab="texture"]').click();
 await test('texture upload supplies box UVs; Undo/Redo retain exact geometry and original disk bytes',async()=>{
  await page.locator('#b-texture-input').setInputFiles({name:'Quadrants.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>!threeLab.state.builder.busy&&document.getElementById('b-texture-name').textContent.includes('128'));
  await act('b-texture-apply');let glb=await download(),info=inspectGlb(glb);assert.equal(info.triangles,12);assert.ok(info.json.images.length);assert.ok(info.json.meshes[0].primitives[0].attributes.TEXCOORD_0!==undefined);assert.equal(geometrySignature(glb),geometrySignature(bytes));
  await act('b-undo');assert.equal(inspectGlb(await download()).json.images,undefined);await act('b-redo');assert.ok(inspectGlb(await download()).json.images.length);assert.equal(hash(await model(sourceId)),hash(bytes));
 });
 await test('normal maps and physical glass export together, with editable optical settings',async()=>{
  await page.locator('#b-texture-slot').selectOption('normal');await page.locator('#b-texture-mapping').selectOption('existing');await act('b-texture-apply');for(const slot of ['roughness','metalness']){await page.locator('#b-texture-slot').selectOption(slot);await act('b-texture-apply');}await act('b-glass');
  await page.locator('.builder-material details summary').click();await page.locator('#b-ior').fill('1.45');await page.locator('#b-glass-thickness').fill('0.02');await act('b-material');
  const info=inspectGlb(await download()),m=info.json.materials[0];assert.ok(m.normalTexture);assert.ok(m.pbrMetallicRoughness.metallicRoughnessTexture);assert.ok(m.pbrMetallicRoughness.baseColorTexture);assert.equal(m.extensions.KHR_materials_transmission.transmissionFactor,1);assert.equal(m.extensions.KHR_materials_ior.ior,1.45);assert.equal(m.extensions.KHR_materials_volume.thicknessFactor,.02);assert.equal(m.alphaMode,undefined);
  await page.screenshot({path:output+'/glass-desktop.png'});
 });
 await test('PNG capture uses its own glass environment and leaves the editable scene unchanged',async()=>{
  const before=await page.evaluate(()=>threeLab.state.builder.history);await page.locator('.viewport-png-button').click();await page.locator('#capture-size').selectOption('768');await page.locator('#capture-bg').selectOption('dark');const pending=page.waitForEvent('download');await page.locator('#capture-start').click();const d=await pending,png=await fs.readFile(await d.path());assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.length>5000);await fs.writeFile(output+'/glass-capture.png',png);await page.waitForFunction(()=>document.getElementById('capture-status').textContent.includes('PNG saved'));await page.locator('#capture-close').click();assert.equal(await page.evaluate(()=>threeLab.state.builder.history),before);const j=inspectGlb(await download()).json;assert.equal(j.materials[0].extensions.KHR_materials_transmission.transmissionFactor,1);assert.equal(geometrySignature(await download()),geometrySignature(bytes));
 });
 await test('source-image bake preserves the mesh and existing normal UVs; export embeds the atlas',async()=>{
  await page.locator('#b-material-preset').selectOption('matte');await act('b-material');await page.locator('#b-image-input').setInputFiles({name:'Source quadrants.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>!threeLab.state.builder.busy&&document.getElementById('b-reference-name').textContent.includes('Source'));
  await page.locator('#b-bake-size').selectOption('1024');await act('b-bake');assert.match(await page.locator('#b-bake-status').innerText(),/Baked 2 faces/);baked=await download();const info=inspectGlb(baked);assert.equal(info.triangles,12);assert.equal(geometrySignature(baked),geometrySignature(bytes));const painted=info.json.materials.find(m=>m.name?.includes('source texture'));assert.ok(painted);assert.equal(painted.pbrMetallicRoughness.baseColorTexture.texCoord,1);assert.ok(painted.normalTexture);assert.equal(painted.normalTexture.texCoord??0,0);assert.ok(info.json.images.length>=2);
  await page.locator('#front-view').click();await page.screenshot({path:output+'/source-bake-desktop.png'});
 });
 await test('explicitly duplicated textured edits save as a new disk draft; a fresh browser profile reloads the embedded images',async()=>{
  await page.locator('#b-title').fill('Baked texture fixture');await page.locator('#b-save').click();await page.getByRole('button',{name:'Duplicate and rename',exact:true}).click();await page.waitForFunction(()=>!threeLab.state.builder.busy);editedId=await page.evaluate(()=>threeLab.state.selected);assert.notEqual(editedId,sourceId);assert.equal(hash(await model(sourceId)),hash(bytes));assert.equal(geometrySignature(await model(editedId)),geometrySignature(bytes));
  const fresh=await browser.newContext({viewport:{width:1536,height:1050}}),p=await fresh.newPage();p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());try{await p.goto(url);await p.waitForFunction(()=>window.threeLab);await connect(p);await p.locator('.primary-nav [data-view="assets"]').click();await p.locator('.asset-card[data-asset="'+editedId+'"]').dblclick();await p.waitForFunction(id=>threeLab.state.selected===id&&!threeLab.state.assetLoading,editedId);await p.locator('#edit-builder').click();await p.waitForFunction(()=>threeLab.state.builder.active);assert.equal(await p.evaluate(()=>threeLab.state.builder.triangles),12);await p.screenshot({path:output+'/disk-reopen.png'});}finally{await fresh.close();}
 });
 await test('material changes affect only selected parts and roll back with Undo',async()=>{
  await page.locator('[data-tool-tab="objects"]').click();await act('b-add-primitive');await act('b-glass');const j=inspectGlb(await download()).json;assert.equal(j.meshes.length,2);assert.equal(j.materials.filter(m=>m.extensions?.KHR_materials_transmission?.transmissionFactor>0).length,1);await act('b-undo');assert.equal(inspectGlb(await download()).json.materials.filter(m=>m.extensions?.KHR_materials_transmission?.transmissionFactor>0).length,0);await act('b-undo');
 });
 await test('texture controls remain reachable in the small-screen workspace',async()=>{
  await page.setViewportSize({width:390,height:844});await page.locator('[data-tool-tab="texture"]').click();assert.equal(await page.locator('#b-texture-apply').isVisible(),true);await page.locator('#b-bake').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/texture-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1536,height:1050});
 });
 if(process.env.COIN_GLB&&process.env.COIN_REFERENCE)await test('supplied 1.72M-triangle coin bakes in the actual app, cancels safely and exports without reducing it',async()=>{
  await page.locator('.primary-nav [data-view="create"]').click();const coin=await fs.readFile(process.env.COIN_GLB),coinInfo=inspectGlb(coin);const coinId=await importModel(coin,'Coin bake acceptance.glb');await page.locator('[data-tool-tab="texture"]').click();await page.locator('#b-image-input').setInputFiles(process.env.COIN_REFERENCE);await page.waitForFunction(()=>!threeLab.state.builder.busy&&document.getElementById('b-reference-name').textContent.includes('.png'));await page.locator('#b-bake-size').selectOption('2048');
  await page.locator('#b-bake').click();await page.locator('#b-bake-cancel').waitFor({state:'visible'});await page.locator('#b-bake-cancel').click();await page.waitForFunction(()=>!threeLab.state.builder.busy);assert.equal(await page.evaluate(()=>threeLab.state.builder.history),0);assert.match(await page.locator('#b-bake-status').innerText(),/cancelled/);
  await act('b-bake');const result=await download();assert.equal(inspectGlb(result).triangles,coinInfo.triangles);assert.equal(hash(await model(coinId)),hash(coin));await fs.writeFile(output+'/coin-texture-qa.glb',result);await page.locator('#front-view').click();await page.screenshot({path:output+'/coin-source-texture.png'});
 });
 assert.deepEqual(errors,[]);await fs.writeFile(output+'/result.json',JSON.stringify({ok:true,checks,errors,neuralInference:false,nativeAcceptance:false,performanceAcceptance:false},null,2)+'\n');
} catch(error){await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();service.kill();await new Promise(r=>server.close(r));await fs.rm(disk,{recursive:true,force:true});}
console.log(checks.length+' built-browser material and source-bake checks passed.');
