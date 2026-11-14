import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { metadata,availableName,filterAssets,recipe,encode64,decode64,inspectGlb,digest } from '../src/core.mjs';
import { ModelLibrary } from '../src/library.mjs';
import { ModelWorkshop } from '../src/workshop.mjs';
import { ThreeLabBridge } from '../src/bridge.mjs';
import { fixtureGlb } from './fixtures.mjs';
import { createDefaultShapeRecipe,buildShapeGeometry,compileShapeFormula,moveShapePoint,setShapePairLinked } from '../src/authoring/src/model-format/sol-shape-profile.js';
const { indexedDB } = process.env.FAKE_IDB_PATH ? await import(pathToFileURL(process.env.FAKE_IDB_PATH).href) : await import('fake-indexeddb');
let count=0; const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const glb=fixtureGlb();
await test('real GLB triangles and byte lengths',()=>{const i=inspectGlb(glb);assert.equal(i.triangles,4);assert.equal(i.vertices,12);assert.equal(i.byteLength,glb.length);});
await test('base64 round trip and size admission',()=>{assert.deepEqual(decode64(encode64(glb)),glb);assert.throws(()=>decode64('AAAA',1));assert.throws(()=>decode64('a!%='));});
await test('external GLB references never reach a loader',()=>assert.throws(()=>inspectGlb(fixtureGlb(j=>{j.buffers[0].uri='https://example.invalid/private';})),/External references/));
await test('decoder, attribute and hierarchy budgets',()=>{assert.throws(()=>inspectGlb(fixtureGlb(j=>{j.extensionsRequired=['KHR_draco_mesh_compression'];})));assert.throws(()=>inspectGlb(fixtureGlb(j=>{j.accessors[0].count=100000000;})));assert.throws(()=>inspectGlb(fixtureGlb(j=>{j.nodes[0].children=[0];})));assert.throws(()=>inspectGlb(glb.slice(0,-1)));});
await test('metadata, folders and tags remain bounded',()=>{assert.deepEqual(metadata({title:' Cube ',tags:'Prop, prop, Rock'}).tags,['prop','rock']);assert.throws(()=>metadata({title:'X',folder:'../out'}));assert.throws(()=>metadata({title:' '}));});
await test('case-insensitive conflict resolution preserves both',()=>{assert.equal(availableName('CRATE',[{title:'crate',folder:'Props'},{title:'crate (2)',folder:'props'}],'PROPS'),'CRATE (3)');assert.equal(availableName('crate',[{title:'crate',folder:'Other'}],'Props'),'crate');});
await test('search combines words and metadata',()=>{const rows=[{id:'1',title:'Cargo',tags:['metal'],folder:'Props',notes:'Rusty',origin:'generation',createdAt:'2026'}];assert.equal(filterAssets(rows,{query:'cargo metal rusty'}).length,1);assert.equal(filterAssets(rows,{query:'cargo blue'}).length,0);});
await test('generation settings reject unsupported engines',()=>{assert.equal(recipe({device:'auto'}).resolution,256);assert.throws(()=>recipe({device:'directml'}));assert.throws(()=>recipe({resolution:1024}));});
await test('Hunyuan detail and memory recipes are model-specific and preserve legacy defaults',()=>{
  for(const model of ['hunyuan3d-2mini','hunyuan3d-2','hunyuan3d-2mv','hunyuan3d-2.1'])for(const resolution of [128,256,384,512])assert.deepEqual(recipe({model,resolution,guidanceScale:0,memoryMode:'cpu-offload',numChunks:4000,steps:75,seed:19}),{model,device:'auto',resolution,seed:19,steps:75,guidanceScale:0,memoryMode:'cpu-offload',numChunks:4000});
  assert.deepEqual(recipe({model:'hunyuan3d-2',resolution:256}),{model:'hunyuan3d-2',device:'auto',resolution:256,seed:0,steps:30,guidanceScale:5,memoryMode:'gpu',numChunks:8000});
  for(const values of [{imagePadding:true},{imagePadding:NaN},{imagePadding:.049},{imagePadding:.251},{guidanceScale:true},{guidanceScale:NaN},{guidanceScale:21},{numChunks:999},{numChunks:4000.5},{memoryMode:'auto'},{resolution:1024}])assert.throws(()=>recipe({model:'hunyuan3d-2',...values}));
  for(const model of ['triposr','triposg'])assert.throws(()=>recipe({model,resolution:384}));
});
const lib=new ModelLibrary({indexedDB,name:'test-'+crypto.randomUUID()});let saved;
await test('GLB and metadata save atomically with independent identity',async()=>{saved=await lib.save({bytes:glb,info:{title:'Crate',folder:'Props',tags:['metal']}});assert.equal((await lib.list()).length,1);const data=await lib.get(saved.asset.id);assert.deepEqual(new Uint8Array(await data.files.glb.arrayBuffer()),glb);assert.equal(data.asset.sha256,await digest(glb));});
await test('import collision is renamed and reported',async()=>{const second=await lib.save({bytes:glb,info:{title:'crate',folder:'props'}});assert.equal(second.asset.title,'crate (2)');assert.equal(second.renamed,true);});
await test('stale metadata revisions cannot overwrite',async()=>{await lib.update(saved.asset.id,1,{title:'Cargo',folder:'Props',tags:['metal']});await assert.rejects(()=>lib.update(saved.asset.id,1,{title:'Wrong'}),/changed/);});
await test('reopening the store retains exact bytes',async()=>{lib.close();const row=await lib.get(saved.asset.id);assert.equal(row.asset.title,'Cargo');assert.deepEqual(new Uint8Array(await row.files.glb.arrayBuffer()),glb);});
await test('delete is revision guarded and affects only the target',async()=>{await assert.rejects(()=>lib.remove(saved.asset.id,1));await lib.remove(saved.asset.id,2);assert.equal((await lib.list()).length,1);});
const source={blob:new Blob(['fixture'],{type:'image/png'}),imagePng:'Zml4dHVyZQ==',name:'ref.png',width:64,height:64,sha256:'f'.repeat(64)};
await test('Hunyuan settings reach preparation and survive generation, save and reopening',async()=>{
 const calls=[],settings={model:'hunyuan3d-2',device:'cuda',resolution:512,seed:23,steps:75,guidanceScale:0,memoryMode:'cpu-offload',numChunks:4000,imagePadding:.05};
 const engine={status:async()=>({loaded:true}),prepare:async v=>{calls.push(v);return{};},render:async v=>{calls.push(v);return {...v,modelGlb:encode64(glb)};}};
 const w=new ModelWorkshop(engine,lib);await w.prepare(settings,true);assert.equal(calls[0].memoryMode,'cpu-offload');assert.equal(calls[0].numChunks,undefined);
 const saved=await w.generate({source,settings,info:{title:'High detail'}});lib.close();const reopened=await lib.get(saved.asset.id);assert.deepEqual(reopened.asset.recipe,settings);assert.deepEqual(new Uint8Array(await reopened.files.glb.arrayBuffer()),glb);
 const old=new ModelWorkshop({...engine,render:async v=>({model:v.model,resolution:v.resolution,modelGlb:encode64(glb)})},lib);await assert.rejects(()=>old.generate({source,settings,info:{title:'Unconfirmed controls'}}),/did not confirm/);assert.equal(old.unsaved,null);
});
let resolveRender,cancels=0,prepares=0;
const engine={status:async()=>({loaded:true}),prepare:async()=>{prepares++;return{};},render:()=>new Promise(resolve=>{resolveRender=resolve;}),cancel:async()=>{cancels++;return{cancelled:true};}};
const workshop=new ModelWorkshop(engine,lib);
await test('preparation requires explicit licence acceptance',async()=>{await assert.rejects(()=>workshop.prepare({},false));assert.equal(prepares,0);});
await test('stop holds the lease until the original render settles',async()=>{
  const pending=workshop.generate({source,settings:{resolution:128},info:{title:'Generated'}});assert.equal(workshop.busy,true);await workshop.cancel();assert.equal(cancels,1);assert.equal(workshop.busy,true);await assert.rejects(()=>workshop.generate({source,settings:{},info:{title:'second'}}),/Wait/);
  resolveRender({model:'triposr',resolution:128,modelGlb:encode64(glb),deviceName:'Test fixture'});const result=await pending;assert.equal(workshop.busy,false);assert.equal(result.asset.origin,'generation');assert.equal((await lib.get(result.asset.id)).files.image.type,'image/png');
});
await test('save failure retains completed output and supports retry',async()=>{
  let fail=true;const storage={save:async value=>{if(fail)throw new Error('disk full');return lib.save(value);}};
  const w=new ModelWorkshop({...engine,render:async()=>({model:'triposr',resolution:256,modelGlb:encode64(glb)})},storage);
  await assert.rejects(()=>w.generate({source,settings:{},info:{title:'Retained'}}),/disk full/);assert.deepEqual(w.unsaved.bytes,glb);assert.equal(w.busy,false);await assert.rejects(()=>w.generate({source,settings:{},info:{title:'new'}}),/retained/);fail=false;await w.saveRetained();assert.equal(w.unsaved,null);
});
await test('completed invalid GLB output is retained exactly and cannot enter the library',async()=>{
 const broken=glb.slice(),size=new DataView(broken.buffer).getUint32(12,true);broken[20]=0;
 let saves=0;const storage={save:async()=>{saves++;throw Error('Unexpected save');}},w=new ModelWorkshop({...engine,render:async()=>({model:'triposr',resolution:256,modelGlb:encode64(broken)})},storage);
 await assert.rejects(()=>w.generate({source,settings:{},info:{title:'Recovery'}}),/Invalid GLB metadata/);assert.deepEqual(w.unsaved.bytes,broken);assert.match(w.unsaved.validationError,/metadata/);assert.equal(w.busy,false);assert.equal(saves,0);await assert.rejects(()=>w.saveRetained(),/recovery/);await assert.rejects(()=>w.generate({source,settings:{},info:{title:'Another'}}),/retained/);w.discardRetained();assert.equal(w.unsaved,null);assert.equal(saves,0);
});
await test('mismatched engine results are rejected',async()=>{const w=new ModelWorkshop({...engine,render:async()=>({model:'wrong',resolution:256,modelGlb:encode64(glb)})},lib);await assert.rejects(()=>w.generate({source,settings:{},info:{title:'Mismatch'}}),/does not match/);assert.equal(w.unsaved,null);});
await test('scoped bridge does not borrow parent APIs or swap provider',()=>{
  const scope={parent:{capp:{ai:{local:{}}}}};const b=new ThreeLabBridge(scope);assert.throws(()=>b.connect(),/installed/);let options;scope.capp={ai:{local:{models3d:{connect:o=>{options=o;return{status(){},prepare(){},render(){},cancel(){},dispose(){}};}}}}};b.connect();assert.equal(options.protocol,'capp.local-models3d.v1');assert.equal('appId' in options,false);scope.capp.ai.local={};assert.throws(()=>b.connect(),/provider changed/);
});
await test('extracted Shape Studio produces actual mesh geometry',()=>{const shape=createDefaultShapeRecipe('hull'),mesh=buildShapeGeometry(shape);assert.ok(mesh.vertices.length>100);assert.ok(mesh.faces.length>100);assert.equal(mesh.normals.length,mesh.vertices.length);assert.equal(compileShapeFormula('sin(pi*t)')(.5),1);assert.throws(()=>compileShapeFormula('globalThis.alert(1)'));const independent=setShapePairLinked(shape,1,'outline',false),changed=moveShapePoint(independent,1,'upper',{reach:.2});assert.notDeepEqual(buildShapeGeometry(changed).vertices,mesh.vertices);});
lib.close();console.log(`${count} focused checks passed. Controlled engine replies are not neural inference.`);
