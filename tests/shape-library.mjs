import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ModelLibrary} from '../src/library.mjs';
import {createShapeDocument,createShapePart,normalizeShapeDocument} from '../src/shape-document.mjs';
import {ShapeSessionStore,SHAPE_SESSION_KEY,SHAPE_SESSION_MAX_BYTES} from '../src/shape-session.mjs';
import {fixtureGlb} from './fixtures.mjs';
const {indexedDB,IDBObjectStore}=process.env.FAKE_IDB_PATH?await import(pathToFileURL(process.env.FAKE_IDB_PATH).href):await import('fake-indexeddb');
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const bytes=fixtureGlb(),lib=new ModelLibrary({indexedDB,name:'shape-'+crypto.randomUUID()}),ref=new Blob(['shape-reference'],{type:'image/png'});
const source={blob:ref,name:'profile.png',width:64,height:64,sha256:'a'.repeat(64),views:{left:{blob:ref,name:'left.png',width:64,height:64,sha256:'b'.repeat(64)}}};
const document=createShapeDocument({title:'Canopy',parts:[createShapePart('profile','hull'),createShapePart('extrude','arch')]});
let original,saved;

await test('Shape Lab saves exact mesh, reference and editable recipe with independent identity',async()=>{
  original=await lib.save({bytes,info:{title:'Source hull'}});
  saved=await lib.save({bytes,info:{title:'Canopy',folder:'Ships'},origin:'shape',shapeDocument:document,source});
  const row=await lib.get(saved.asset.id);
  assert.notEqual(saved.asset.id,original.asset.id);assert.equal(saved.asset.origin,'shape');assert.equal(saved.asset.recipe,null);assert.equal(saved.asset.edit,null);
  assert.deepEqual(saved.asset.shape,{version:1,parts:2});assert.deepEqual(row.files.shapeDocument,document);assert.deepEqual(new Uint8Array(await row.files.glb.arrayBuffer()),bytes);
  assert.equal(await row.files.image.text(),'shape-reference');assert.equal(await row.files.views.left.blob.text(),'shape-reference');
});
await test('Shape Lab document survives close and reopen without exposing shared mutations',async()=>{
  lib.close();const row=await lib.get(saved.asset.id);assert.deepEqual(row.files.shapeDocument,document);
  row.files.shapeDocument.parts[0].name='Mutated fetched copy';assert.deepEqual((await lib.get(saved.asset.id)).files.shapeDocument,document);
});
await test('Repeated shape saves preserve both recipes and resolve names',async()=>{
  const next=structuredClone(document);next.parts[0].name='Updated hull';
  const second=await lib.save({bytes,info:{title:'Canopy',folder:'Ships'},origin:'shape',shapeDocument:next});
  assert.equal(second.asset.title,'Canopy (2)');assert.equal(second.renamed,true);assert.deepEqual((await lib.get(saved.asset.id)).files.shapeDocument,document);
  assert.equal((await lib.get(second.asset.id)).files.shapeDocument.parts[0].name,'Updated hull');
});
await test('Shape metadata updates retain recipe and honor stale revision guards',async()=>{
  const updated=await lib.update(saved.asset.id,1,{title:'Canopy final',folder:'Ships'});assert.equal(updated.revision,2);assert.deepEqual(updated.shape,{version:1,parts:2});
  await assert.rejects(()=>lib.update(saved.asset.id,1,{title:'Lost race'}),/changed/);await assert.rejects(()=>lib.remove(saved.asset.id,1),/changed/);
  assert.deepEqual((await lib.get(saved.asset.id)).files.shapeDocument,document);
});
await test('Missing, invalid and oversized shape sources cannot create partial drafts',async()=>{
  const before=(await lib.list()).length;
  await assert.rejects(()=>lib.save({bytes,info:{title:'Missing'},origin:'shape'}),/editable shape document/);
  for(const shapeDocument of [{...document,version:999},{...document,parts:[]},{...document,parts:Array.from({length:65},()=>document.parts[0])},{...document,parts:[{...document.parts[0],transform:{scale:[0,1,1]}}]}]){
    await assert.rejects(()=>lib.save({bytes,info:{title:'Invalid'},origin:'shape',shapeDocument}));
  }
  assert.equal((await lib.list()).length,before);assert.equal(await lib.transaction('readonly',s=>request(s('files').count())),before);
});
await test('Builder edits and ordinary imports cannot advertise an unchanged editable shape source',async()=>{
  const before=(await lib.list()).length,edit={parentId:saved.asset.id,parentSha256:saved.asset.sha256,operations:['Cut outline']};
  await assert.rejects(()=>lib.save({bytes,info:{title:'Wrong shape association'},origin:'edit',edit,shapeDocument:document}),/only be saved with Shape Lab/);
  await assert.rejects(()=>lib.save({bytes,info:{title:'Wrong import association'},shapeDocument:document}),/only be saved with Shape Lab/);
  const result=await lib.save({bytes,info:{title:'Canopy mesh edit'},origin:'edit',edit});assert.equal(result.asset.shape,null);assert.equal((await lib.get(result.asset.id)).files.shapeDocument,null);assert.equal((await lib.list()).length,before+1);
});
await test('Save snapshots the recipe before asynchronous hashing without mutating input',async()=>{
  const input=structuredClone(document),snapshot=structuredClone(input),pending=lib.save({bytes,info:{title:'Snapshot'},origin:'shape',shapeDocument:input});
  input.parts[0].name='Later edit';const result=await pending;assert.deepEqual((await lib.get(result.asset.id)).files.shapeDocument,snapshot);assert.equal(input.parts[0].name,'Later edit');
  assert.deepEqual(document,normalizeShapeDocument(document));assert.deepEqual(new Uint8Array(await(await lib.get(original.asset.id)).files.glb.arrayBuffer()),bytes);
});
await test('An asset-store failure rolls back mesh and recipe together and retains caller document',async()=>{
  const before=(await lib.list()).length,input=structuredClone(document),expected=structuredClone(input),add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(value,...args){if(this.name==='assets')throw new DOMException('Injected full storage','QuotaExceededError');return add.call(this,value,...args);};
  try{await assert.rejects(()=>lib.save({bytes,info:{title:'Retained shape'},origin:'shape',shapeDocument:input}),/storage is full/);}finally{IDBObjectStore.prototype.add=add;}
  assert.deepEqual(input,expected);assert.equal((await lib.list()).length,before);assert.equal(await lib.transaction('readonly',s=>request(s('files').count())),before);
  const retry=await lib.save({bytes,info:{title:'Retained shape'},origin:'shape',shapeDocument:input});assert.deepEqual((await lib.get(retry.asset.id)).files.shapeDocument,expected);
});

const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},session=new ShapeSessionStore({storage});
await test('Separate local Shape Lab session restores normalized editable state',()=>{
  assert.equal(session.load(),null);session.save(document);const restored=session.load();assert.deepEqual(restored,document);assert.equal(values.size,1);assert.equal(values.has(SHAPE_SESSION_KEY),true);
  restored.parts[0].name='Read copy';assert.deepEqual(session.load(),document);session.clear();assert.equal(session.load(),null);
});
await test('Invalid session saves preserve the last valid recipe and caller state',()=>{
  session.save(document);const previous=values.get(SHAPE_SESSION_KEY),invalid={...document,version:42};assert.throws(()=>session.save(invalid),/version/);assert.equal(values.get(SHAPE_SESSION_KEY),previous);assert.equal(invalid.version,42);
});
await test('Quota failure retains saved session and reports recovery action',()=>{
  const previous=values.get(SHAPE_SESSION_KEY),full=new ShapeSessionStore({storage:{...storage,setItem(){throw new DOMException('full','QuotaExceededError');}}});
  assert.throws(()=>full.save(document),/current shape remains open/);assert.equal(values.get(SHAPE_SESSION_KEY),previous);assert.deepEqual(full.load(),document);
});
await test('Corrupt and over-budget local sessions report failure without deleting recovery data',()=>{
  for(const raw of ['{bad json',JSON.stringify({...document,version:42}),' '.repeat(SHAPE_SESSION_MAX_BYTES+1)]){
    values.set(SHAPE_SESSION_KEY,raw);assert.throws(()=>session.load(),/could not be restored/);assert.equal(values.get(SHAPE_SESSION_KEY),raw);
  }
});
await test('Unavailable or blocked session storage fails with actionable messages',()=>{
  const absent=new ShapeSessionStore({storage:null});assert.throws(()=>absent.load(),/unavailable/);assert.throws(()=>absent.save(document),/Download/);absent.clear();
  const blocked=new ShapeSessionStore({storage:{getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}}});
  assert.throws(()=>blocked.load(),/could not read/);assert.throws(()=>blocked.save(document),/could not save/);assert.throws(()=>blocked.clear(),/could not clear/);
});
lib.close();console.log(`${count} Shape Lab storage checks passed.`);
