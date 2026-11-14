import {localFiles,localFileRequest,localConnection} from './local-files.mjs';
import {assetConnection} from './asset-connection.mjs';
import {ModelLibrary,prepareAssetRecord} from './library.mjs';
import {check,digest,metadata,availableName} from './core.mjs';
export const DISK_CONNECTION_KEY='capp.3d-lab.disk.connection.v1';
export const DISK_PROTOCOL='capp.3d-lab.disk.v1';
export function storageConnection(value){return assetConnection(value);}
export class DiskClient{
 constructor({fetch=globalThis.fetch}={}){this.fetch=fetch.bind(globalThis);this.connection=null;this.status=null;}
 async request(route,{method='GET',value,body,raw=false,timeout=60000}={}){
  check(this.connection,'Open local asset storage before saving.');
  if(this.connection?.local)return localFileRequest('model',route,{method,value,body,raw,rootId:this.status?.rootId});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await this.fetch(this.connection.origin+'/v1/'+route,{method,headers:{Authorization:'Bearer '+this.connection.token,...(value!==undefined?{'Content-Type':'application/json'}:{})},body:value!==undefined?JSON.stringify(value):body,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});
   if(!response.ok){const error=await response.json().catch(()=>({}));const failure=Error(error.error||'Draft storage returned '+response.status+'.');failure.status=response.status;throw failure;}
   return raw?new Uint8Array(await response.arrayBuffer()):await response.json();
  }catch(error){if(error.name==='AbortError'||error instanceof TypeError)throw Error('Asset storage is unavailable. Reconnect the folder or remote connection. The current work is retained.');throw error;}
  finally{clearTimeout(timer);}
 }
 async connect(link){const old=this.connection,oldStatus=this.status;this.connection=storageConnection(link||'capp-local:model');this.status=null;try{const state=await this.request('status',{timeout:8000});check(state.protocol===DISK_PROTOCOL,'That service is not the 3D draft store.');this.status=state;return state;}catch(e){this.connection=old;this.status=oldStatus;throw e;}}
 async encode(value,upload=false){
  if(value instanceof Blob){const bytes=new Uint8Array(await value.arrayBuffer()),sha256=await digest(bytes);if(upload){if(this.connection?.local&&this.status?.chunkedBlobs&&value.size>(this.status.blobChunkBytes||8*1024**2)){const step=this.status.blobChunkBytes||8*1024**2;for(let offset=0;offset<value.size;offset+=step)await this.request('blob-chunks/'+sha256+'/'+offset,{method:'PUT',value:{size:value.size},body:value.slice(offset,offset+step)});}else await this.request('blobs/'+sha256,{method:'PUT',body:value});}return {$blob:{sha256,size:value.size,type:value.type||'application/octet-stream'}};}
  if(Array.isArray(value))return Promise.all(value.map(v=>this.encode(v,upload)));
  if(value&&typeof value==='object'){const out={};for(const [key,v]of Object.entries(value)){if(v!==undefined&&!['diskStamp','diskPath'].includes(key))out[key]=await this.encode(v,upload);}return out;}return value;
 }
 async decode(value){
  if(value&&typeof value==='object'&&Object.hasOwn(value,'$blob')){const ref=value.$blob;let bytes;
   if(this.connection?.local&&this.status?.chunkedBlobs&&ref.size>(this.status.blobChunkBytes||8*1024**2)){const info=await this.request('blob-info/'+ref.sha256);check(info.exists&&info.size===ref.size,'Stored file size mismatch.');bytes=new Uint8Array(ref.size);const step=this.status.blobChunkBytes||8*1024**2;for(let offset=0;offset<ref.size;offset+=step){const part=await this.request('blob-chunks/'+ref.sha256+'/'+offset,{raw:true});check(part.length===Math.min(step,ref.size-offset),'Stored chunk size mismatch.');bytes.set(part,offset);}}
   else bytes=await this.request('blobs/'+ref.sha256,{raw:true});check(bytes.length===ref.size&&await digest(bytes)===ref.sha256,'Stored file checksum mismatch. The working draft has not been replaced.');return new Blob([bytes],{type:ref.type});}
  if(Array.isArray(value))return Promise.all(value.map(v=>this.decode(v)));
  if(value&&typeof value==='object'){const out={};for(const [key,v]of Object.entries(value))out[key]=await this.decode(v);return out;}return value;
 }
}
const snapshot=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export class DiskModelLibrary{
 constructor({cache=new ModelLibrary(),client=new DiskClient(),connectionStorage,onChange=()=>{}}={}){
  this.cache=cache;this.client=client;this.onChange=onChange;this.connectionStorage=connectionStorage;this.mode='offline';this.message='Connect asset storage to save permanently. Browser copies are available for recovery.';this.migration=null;this.pending=0;this.failed=[];this.saveAttempts=new WeakMap();
 }
 status(){return {mode:this.mode,message:this.message,root:this.client.status?.root||'',pending:this.pending,failures:[...this.failed]};}
 report(mode,message){this.mode=mode;this.message=message;this.onChange(this.status());}
 async restore(){let link;try{link=this.connectionStorage?.getItem(DISK_CONNECTION_KEY);}catch{}if(link)try{await this.connect(link);}catch(e){this.report('offline',e.message);}return this;}
 async connect(link){
  check(!this.pending&&!this.migration,'Wait for the current disk operation before reconnecting.');
  await this.client.connect(link);try{this.connectionStorage?.setItem(DISK_CONNECTION_KEY,this.client.connection.link);}catch{}
  this.migration=this.migrate();try{await this.migration;}finally{this.migration=null;}return this;
 }
 async fingerprint(bundle){return digest(new TextEncoder().encode(snapshot(bundle)));}
 async mirror(record,serverFingerprint){
  const encoded=await this.client.encode(record),stamp={local:await this.fingerprint(encoded),server:serverFingerprint,root:this.client.status?.root};
  try{await this.cache.putRecord({asset:record.asset,files:{...record.files,diskStamp:stamp}},{synced:true});}catch(error){this.report('ready','Saved on disk. Browser cache unavailable: '+error.message);}
 }
 async migrate(){
  this.failed=[];this.report('migrating','Checking browser drafts against the permanent folder…');
  let rows;try{rows=await this.cache.list();}catch(e){this.report('ready','Disk connected. Browser recovery could not be read: '+e.message);return;}
  const manifest=await this.client.request('assets'),present=new Set(manifest.assets.map(r=>r.id)),deleted=new Set(manifest.deleted||[]);
  let copied=0,skipped=0;
  for(let i=0;i<rows.length;i++){
   const row=rows[i];this.report('migrating',`Migrating browser drafts ${i+1}/${rows.length}: ${row.title}`);
   try{
    const {_diskCache,...metadata}=row;
    if(_diskCache?.root===this.client.status?.root&&_diskCache.metadata===JSON.stringify(metadata)&&(present.has(row.id)||deleted.has(row.id))){skipped++;continue;}
    const record=await this.cache.get(row.id),bundle=await this.client.encode(record),local=await this.fingerprint(bundle);
    if(record.files.diskStamp?.local===local&&record.files.diskStamp.root===this.client.status?.root&&(present.has(row.id)||deleted.has(row.id))){await this.cache.putRecord(record,{synced:true});skipped++;continue;}
    await this.client.encode(record,true);
    const result=await this.client.request('assets',{method:'POST',value:{bundle,migrate:true}});
    if(!result.deleted){
     // Mark the original even if the server retained a conflicting copy under a new ID.
     await this.cache.putRecord({asset:record.asset,files:{...record.files,diskStamp:{local,server:result.fingerprint,root:this.client.status?.root}}},{synced:true});
     if(result.bundle.asset.id!==record.asset.id)await this.mirror(await this.client.decode(result.bundle),result.fingerprint);
    }else await this.cache.remove(row.id,row.revision);
    copied++;
   }catch(e){this.failed.push({id:row.id,title:row.title,error:e.message});}
  }
  this.report('ready',this.failed.length?`${copied} drafts migrated; ${this.failed.length} need retry. Browser originals retained. See migration details.`:`Disk connected · ${copied} drafts migrated · ${skipped} already backed up. Browser copies retained as cache.`);
 }
 async ensureWritable(){if(this.migration)await this.migration;check(this.client.connection,'Connect Asset storage before saving. Your open work is retained.');try{await this.client.request('status',{timeout:8000});}catch(e){this.report('offline',e.message);throw e;}}
 async operation(fn,{optional=false}={}){this.pending++;this.onChange(this.status());try{await this.ensureWritable();return await fn();}catch(e){this.report(optional?'ready':'error',(optional?'Preview thumbnail was not updated. The existing draft is retained. ':'Not saved to disk: ')+e.message);throw e;}finally{this.pending--;this.onChange(this.status());}}
 async list(){
  // The disk catalogue is already authoritative while browser recovery runs.
  // Browsing must not wait for every legacy cached mesh to be hashed/migrated.
  if(this.client.connection)try{const {assets}=await this.client.request('assets');const failed=new Set(this.failed.map(v=>v.id));const recovery=failed.size?(await this.cache.list()).filter(r=>failed.has(r.id)&&!assets.some(a=>a.id===r.id)):[];return [...assets,...recovery];}catch(e){this.report('offline','Disk unavailable · showing browser cache. '+e.message);}
  try{return await this.cache.list();}catch(e){if(this.client.connection)throw e;return [];}
 }
 async preview(id){
  if(!this.client.connection||this.failed.some(r=>r.id===id))return this.cache.preview(id);
  if(this.client.connection.local&&this.client.status?.previewReads){const bytes=await this.client.request('assets/'+encodeURIComponent(id)+'/preview',{raw:true});return bytes.length?new Blob([bytes],{type:'image/png'}):null;}
  const {bundle}=await this.client.request('assets/'+encodeURIComponent(id)),ref=bundle.files.thumbnail||bundle.files.image;
  return ref?this.client.decode(ref):null;
 }
 async get(id){
  if(this.migration)await this.migration;
  if(!this.client.connection||this.failed.some(r=>r.id===id))return this.cache.get(id);
  let result;try{result=await this.client.request('assets/'+encodeURIComponent(id));}catch(e){this.report('offline','Disk read failed · cached copy only. '+e.message);if(!e.status){try{return await this.cache.get(id);}catch{}}throw e;}
  let cached;try{cached=await this.cache.get(id);}catch{}
  if(cached?.files.diskStamp?.server===result.fingerprint&&cached.files.diskStamp.local===await this.fingerprint(await this.client.encode(cached)))return {...cached,path:result.path,modelPath:result.modelPath};
  const record=await this.client.decode(result.bundle);await this.mirror(record,result.fingerprint);return {...record,path:result.path,modelPath:result.modelPath};
 }
 async save(options){
  // Capture recipes synchronously in prepareAssetRecord before any I/O.
  let attempt=this.saveAttempts.get(options);if(!attempt){attempt={create:prepareAssetRecord(options)};attempt.create.catch(()=>{});this.saveAttempts.set(options,attempt);}
  return this.operation(async()=>{
   if(!attempt.record){const create=await attempt.create;attempt.record=create(await this.list());}
   const record=attempt.record;if(record.existing)return {asset:record.asset,renamed:false};
   const bundle=await this.client.encode({asset:record.asset,files:record.files},true);
   const result=await this.client.request('assets',{method:'POST',value:{bundle}});
   await this.mirror({asset:result.bundle.asset,files:record.files},result.fingerprint);
   this.report('ready','Saved to '+result.path);this.saveAttempts.delete(options);return {asset:result.bundle.asset,renamed:record.renamed||result.bundle.asset.title!==record.asset.title,path:result.path};
  });
 }
 async revise(options,id,revision){
  const captured=prepareAssetRecord(options);captured.catch(()=>{});
  return this.operation(async()=>{
   const current=await this.client.request('assets/'+encodeURIComponent(id));
   check(current.bundle.asset.revision===revision,'This asset changed in another window. Reopen it before saving.');
   const old=await this.client.decode(current.bundle),{revisionRecord}=await import('./asset-lifecycle.mjs');
   const create=await captured;const next=await revisionRecord(options,old,await this.list(),create);
   const bundle=await this.client.encode({asset:next.asset,files:next.files},true);
   const result=await this.client.request('assets',{method:'POST',value:{bundle,expected:current.fingerprint}});
   await this.mirror({asset:result.bundle.asset,files:next.files},result.fingerprint);
   this.report('ready','Saved revision '+result.bundle.asset.revision+' on disk.');return {asset:result.bundle.asset,renamed:next.renamed,path:result.path};
  });
 }
 async curate(id,revision,workPackage,workNotes=''){return this.operation(async()=>{
  check(typeof workPackage==='boolean'&&typeof workNotes==='string'&&workNotes.length<=4000,'Invalid work ZIP selection.');
  const old=await this.client.request('assets/'+encodeURIComponent(id));check(old.bundle.asset.revision===revision,'This asset changed. Reopen it before selecting.');
  old.bundle.asset={...old.bundle.asset,workPackage,workNotes,revision:revision+1,updatedAt:new Date().toISOString()};
  const result=await this.client.request('assets',{method:'POST',value:{bundle:old.bundle,expected:old.fingerprint}});
  await this.mirror(await this.client.decode(result.bundle),result.fingerprint);return result.bundle.asset;
 });}
 async update(id,revision,value){const meta=metadata(value);return this.operation(async()=>{
  const old=await this.client.request('assets/'+encodeURIComponent(id));check(old.bundle.asset.revision===revision,'This asset changed in another window. Reopen it before saving.');
  const rows=await this.list();check(availableName(meta.title,rows.filter(r=>r.id!==id),meta.folder)===meta.title,'That name already exists in this folder. Choose a different name.');
  const bundle=old.bundle;bundle.asset={...bundle.asset,...meta,revision:revision+1,updatedAt:new Date().toISOString()};
  const result=await this.client.request('assets',{method:'POST',value:{bundle,expected:old.fingerprint}});await this.mirror(await this.client.decode(result.bundle),result.fingerprint);this.report('ready','Asset details saved to disk.');return result.bundle.asset;
 });}
 async thumbnail(id,blob){check(blob instanceof Blob&&blob.type==='image/png'&&blob.size<=1024**2,'Invalid thumbnail.');return this.operation(async()=>{
  const old=await this.client.request('assets/'+encodeURIComponent(id));old.bundle.files.thumbnail=await this.client.encode(blob,true);
  const result=await this.client.request('assets',{method:'POST',value:{bundle:old.bundle,expected:old.fingerprint}});
  // A thumbnail is optional. Do not turn an acknowledged model save into a failure.
  let cached;try{cached=await this.cache.get(id);}catch{}if(cached)await this.mirror({asset:result.bundle.asset,files:{...cached.files,thumbnail:blob}},result.fingerprint);
 },{optional:true});}
 async remove(id,revision){return this.operation(async()=>{await this.client.request('assets/'+encodeURIComponent(id),{method:'DELETE',value:{revision}});try{const r=await this.cache.get(id);await this.cache.remove(id,r.asset.revision);}catch{}this.report('ready','Removed from the catalogue. Its disk revisions are retained for recovery.');});}
 close(){this.cache.close();}
}
