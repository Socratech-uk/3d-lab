import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { decode64, inspectGlb, LIMITS, digest } from '../src/core.mjs';
import { ModelLibrary } from '../src/library.mjs';
import { ModelWorkshop } from '../src/workshop.mjs';
import { fixtureLargeGlb } from './fixtures.mjs';
const { indexedDB } = process.env.FAKE_IDB_PATH ? await import(pathToFileURL(process.env.FAKE_IDB_PATH).href) : await import('fake-indexeddb');
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const glb=fixtureLargeGlb(),encoded=Buffer.from(glb).toString('base64');

await test('multi-megabyte GLB decodes without overflowing the stack',()=>{
  assert.ok(glb.length>4*1024**2);assert.deepEqual(decode64(encoded),glb);
  const model=inspectGlb(glb);assert.equal(model.triangles,204800);assert.equal(model.vertices,103041);
});
await test('binary values and padding survive chunk boundaries',()=>{
  for(const size of [1,2,3,49151,49152,49153,98303,98304,98305]) {
    const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=(i*137+19)%256;
    assert.deepEqual(Buffer.from(decode64(bytes.toString('base64'))),bytes);
  }
});
await test('malformed alphabet and padding remain rejected',()=>{
  for(const value of ['',null,42,'A','AA','AAA','A===','====','AA=A','A=AA','AA==AAAA','AAAA=','AA-_','AA\nA','AA A','AAéA','AAAA\u0000'])
    assert.throws(()=>decode64(value),/Invalid or oversized encoded file/);
  for(const offset of [0,Math.floor(encoded.length/2),encoded.length-1])
    assert.throws(()=>decode64(encoded.slice(0,offset)+'!'+encoded.slice(offset+1)),/Invalid or oversized encoded file/);
});
await test('exact decoded length enforces caller budgets for each padding form',()=>{
  for(const size of [1,2,3,49151,49152,49153]) {
    const value=Buffer.alloc(size,249).toString('base64');
    assert.equal(decode64(value,size).length,size);
    assert.throws(()=>decode64(value,size-1),/Invalid or oversized encoded file|too large/);
  }
});
await test('encoded model data above the old 64 MiB ceiling decodes without reducing detail',()=>{
  const bytes=Buffer.alloc(68*1024**2,231);bytes[0]=0;bytes[bytes.length-1]=255;
  assert.deepEqual(Buffer.from(decode64(bytes.toString('base64'))),bytes);
});

const library=new ModelLibrary({indexedDB,name:'large-models-'+crypto.randomUUID()});
const source={blob:new Blob(['fixture'],{type:'image/png'}),imagePng:'Zml4dHVyZQ==',name:'ref.png',width:64,height:64,sha256:'f'.repeat(64)};
const bridge={render:async options=>({model:options.model,resolution:options.resolution,modelGlb:encoded})};
let saved;
await test('256-detail generation saves and reopens the complete large output',async()=>{
  const workshop=new ModelWorkshop(bridge,library);
  saved=await workshop.generate({source,settings:{resolution:256},info:{title:'Large generated mesh'}});
  assert.equal(workshop.busy,false);assert.equal(workshop.unsaved,null);assert.equal(saved.asset.triangles,204800);
  library.close();const reopened=await library.get(saved.asset.id);
  assert.deepEqual(new Uint8Array(await reopened.files.glb.arrayBuffer()),glb);assert.equal(reopened.asset.sha256,await digest(glb));
});
await test('a failed save retains the large mesh for exact download and retry',async()=>{
  let fail=true;const workshop=new ModelWorkshop(bridge,{save:value=>{if(fail)throw new Error('Storage full');return library.save(value);}});
  await assert.rejects(()=>workshop.generate({source,settings:{resolution:256},info:{title:'Large retained mesh'}}),/Storage full/);
  assert.deepEqual(workshop.unsaved.bytes,glb);assert.equal(workshop.busy,false);
  fail=false;await workshop.saveRetained();assert.equal(workshop.unsaved,null);assert.equal((await library.list()).length,2);
});
library.close();console.log(`${count} large-model checks passed. Synthetic output; no GPU inference claimed.`);
