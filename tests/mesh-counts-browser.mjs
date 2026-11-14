// Built app, real GLB and a temporary disk catalogue. No model inference.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {fixtureLargeGlb} from './fixtures.mjs';
import {inspectGlb} from '../src/core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.resolve(process.env.TEST_OUTPUT||root+'/test-output/mesh-counts');
await fs.mkdir(output,{recursive:true});
const disk=await fs.mkdtemp(path.join(os.tmpdir(),'mesh-counts-browser-')),html=await fs.readFile(root+'/index.html'),bytes=fixtureLargeGlb(710),expected=inspectGlb(bytes);
assert.equal(expected.triangles,1_008_200);
const hash=value=>createHash('sha256').update(value).digest('hex'),checks=[],errors=[];
const test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/',service=spawn('python3',[root+'/tools/asset_storage.py','--root',disk,'--port','0'],{stdio:['ignore','pipe','pipe']});
const link=await new Promise((resolve,reject)=>{let stdout='',stderr='';service.stderr.on('data',b=>stderr+=b);service.once('exit',c=>reject(Error('Disk fixture exited '+c+' '+stderr)));service.stdout.on('data',b=>{stdout+=b;const match=stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#storage=[A-Za-z0-9_-]+/);if(match)resolve(match[0]);});});
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_PATH||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright/index.mjs'));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{...process.env,LD_LIBRARY_PATH:path.dirname(process.env.CHROMIUM_PATH)}});
const context=await browser.newContext({viewport:{width:1536,height:1050},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const connect=async p=>{await p.locator('#asset-storage-open').click();await p.getByText('Advanced · remote storage',{exact:true}).click();await p.locator('#storage-link').fill(link);await p.locator('#storage-connect').click();await p.waitForFunction(()=>document.getElementById('storage-authoring').textContent.includes('are saved on disk'));await p.locator('#storage-close').click();};
async function model(id){const catalogue=JSON.parse(await fs.readFile(disk+'/catalogue.json','utf8')),folder=disk+'/drafts/'+id+'/'+catalogue.assets[id].fingerprint;return fs.readFile(folder+'/model.glb');}
let sourceId,editedId;
try {
 await page.goto(url);await page.waitForFunction(()=>window.threeLab);await connect(page);
 await test('built app imports and saves 1,008,200 real triangles to disk unchanged',async()=>{
  assert.equal(await page.evaluate(()=>threeLab.version),'0.22.0');
  await page.locator('#glb-input').setInputFiles({name:'Above old mesh cap.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(bytes)});
  await page.waitForFunction(()=>threeLab.state.assets===1&&threeLab.state.selected&&!threeLab.state.assetLoading);
  sourceId=await page.evaluate(()=>threeLab.state.selected);assert.match(await page.locator('#mesh-summary').innerText(),/1,008,200/);assert.equal(hash(await model(sourceId)),hash(bytes));
 });
 await test('Builder edits, Undo and Redo retain the complete high-detail scene',async()=>{
  await page.locator('#edit-builder').click();await page.waitForFunction(()=>threeLab.state.builder.active);
  await page.locator('#b-move-x').fill('1');await page.locator('#b-transform').click();
  await page.waitForFunction(()=>threeLab.state.builder.history===1&&!threeLab.state.builder.busy);
  assert.equal(await page.evaluate(()=>threeLab.state.builder.triangles),expected.triangles);
  await page.locator('#b-undo').click();await page.waitForFunction(()=>threeLab.state.builder.history===0&&!threeLab.state.builder.busy);
  await page.locator('#b-redo').click();await page.waitForFunction(()=>threeLab.state.builder.history===1&&!threeLab.state.builder.busy);
  assert.equal(await page.evaluate(()=>threeLab.state.builder.triangles),expected.triangles);
 });
 await test('edited high-detail GLB saves as a new disk draft with the source preserved',async()=>{
  await page.locator('#b-title').fill('High-detail edited draft');await page.locator('#b-save').click();
  await page.waitForFunction(()=>threeLab.state.assets===2&&!threeLab.state.builder.busy&&!threeLab.state.builder.dirty);
  const catalogue=JSON.parse(await fs.readFile(disk+'/catalogue.json','utf8'));editedId=Object.keys(catalogue.assets).find(id=>id!==sourceId);
  const edited=inspectGlb(await model(editedId));assert.equal(edited.triangles,expected.triangles);assert.equal(edited.vertices,expected.vertices);assert.equal(hash(await model(sourceId)),hash(bytes));
 });
 await test('fresh browser profile reopens the high-detail disk draft in Action Lab',async()=>{
  const fresh=await browser.newContext({viewport:{width:1536,height:1050}}),other=await fresh.newPage();other.setDefaultTimeout(60000);other.on('pageerror',e=>errors.push(e.message));other.on('dialog',d=>d.accept());
  try {await other.goto(url);await other.waitForFunction(()=>window.threeLab);await connect(other);await other.evaluate(id=>threeLab.actions.open(id),editedId);assert.equal(await other.evaluate(()=>threeLab.state.action.active),true);assert.equal(await other.evaluate(()=>threeLab.state.action.source.id),editedId);}finally{await fresh.close();}
 });
 assert.deepEqual(errors,[]);await fs.writeFile(output+'/result.json',JSON.stringify({ok:true,checks,triangles:expected.triangles,vertices:expected.vertices,bytes:bytes.byteLength,errors,neuralInference:false,nativeAcceptance:false,performanceAcceptance:false},null,2)+'\n');
} finally {await browser.close();service.kill();await new Promise(r=>server.close(r));await fs.rm(disk,{recursive:true,force:true});}
console.log(checks.length+' built-browser mesh-count checks passed.');
