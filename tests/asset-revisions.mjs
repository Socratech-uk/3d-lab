import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DiskModelLibrary} from '../src/disk-library.mjs';
import {ModelLibrary} from '../src/library.mjs';
import {createActionDocument,createJoint} from '../src/action-document.mjs';
import {fixtureGlb} from './fixtures.mjs';
const {indexedDB}=process.env.FAKE_IDB_PATH?await import(pathToFileURL(process.env.FAKE_IDB_PATH).href):await import('fake-indexeddb');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=await fs.mkdtemp(path.join(os.tmpdir(),'suite-revisions-'));
const server=spawn('python3',[root+'/tools/asset_storage.py','--root',folder,'--port','0']);let log='';server.stderr.on('data',b=>log+=b);
const link=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(log)),10000);server.stdout.on('data',b=>{log+=b;const found=log.match(/http:\/\/127\.0\.0\.1:\d+\/#storage=[A-Za-z0-9_-]+/);if(found){clearTimeout(timer);resolve(found[0]);}});});
const library=()=>new DiskModelLibrary({cache:new ModelLibrary({indexedDB,name:crypto.randomUUID()})});
const disk=library();let count=0;const test=async(name,fn)=>{await fn();console.log('PASS '+name);count++;};
try{
 await disk.connect(link);const source={name:'Front',width:64,height:64,sha256:'a'.repeat(64),blob:new Blob(['front'],{type:'image/png'}),views:{left:{name:'Left',width:64,height:64,sha256:'b'.repeat(64),blob:new Blob(['left'],{type:'image/png'})}}};
 const created=await disk.save({bytes:fixtureGlb(),info:{title:'Hound'},origin:'generation',generation:{model:'triposr',device:'cpu',resolution:128},source});
 const doc=createActionDocument('Hound');doc.joints=[createJoint([0,0,0],null,'Root')];
 let saved;
 await test('action save keeps the asset ID, generation evidence and all reference bytes',async()=>{saved=await disk.revise({bytes:fixtureGlb(),info:{title:'Hound'},origin:'action',actionDocument:doc},created.asset.id,1);assert.equal(saved.asset.id,created.asset.id);assert.equal(saved.asset.revision,2);assert.equal((await disk.list()).length,1);const current=await disk.get(saved.asset.id);assert.equal(await current.files.image.text(),'front');assert.equal(await current.files.views.left.blob.text(),'left');assert.equal(current.asset.recipe.model,'triposr');assert.equal(current.files.actionDocument.joints[0].id,doc.joints[0].id);});
 await test('concurrent stale saves fail without creating another model',async()=>{await assert.rejects(disk.revise({bytes:fixtureGlb(),info:{title:'Stale'},origin:'action',actionDocument:doc},created.asset.id,1),/changed/);assert.equal((await disk.list()).length,1);});
 await test('rename changes metadata on the same ID and leaves GLB bytes unchanged',async()=>{const before=await disk.get(saved.asset.id);const after=await disk.update(saved.asset.id,saved.asset.revision,{title:'Commander',folder:'NPCs'});assert.equal(after.id,saved.asset.id);assert.equal(after.sha256,before.asset.sha256);saved={asset:after};});
 await test('work selection is durable and a fresh profile reopens it with the rig',async()=>{const selected=await disk.curate(saved.asset.id,saved.asset.revision,true,'Place as a shopkeeper in the cylinder.');const fresh=library();await fresh.connect(link);const reopened=await fresh.get(selected.id);assert.equal(reopened.asset.workPackage,true);assert.match(reopened.asset.workNotes,/shopkeeper/);assert.equal(reopened.files.actionDocument.joints[0].id,doc.joints[0].id);fresh.close();saved={asset:selected};});
 await test('explicit copies receive a new ID while original revisions remain recoverable',async()=>{const copy=await disk.save({bytes:fixtureGlb(),info:{title:'Commander',folder:'NPCs'},origin:'action',actionDocument:doc});assert.notEqual(copy.asset.id,saved.asset.id);assert.equal(copy.asset.title,'Commander (2)');assert.equal((await disk.list()).length,2);const revisions=await fs.readdir(path.join(folder,'drafts',saved.asset.id));assert.ok(revisions.length>=3);});
 console.log(count+' durable asset-revision checks passed.');
}finally{disk.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));await fs.rm(folder,{recursive:true,force:true});}
