import {RigRecipeStore,normalizeRigRecipe} from './action-rig-library.mjs';
const KEYS={
 'capp.3d-lab.action-prompts.v1':'action-prompts',
 'capp.action-lab.flows.v1':'workflows',
 'capp.3d-lab.shapes.v1':'shape-session',
};
export class DiskAuthoringStorage{
 constructor({library,cache,onChange=()=>{},rigCache=new RigRecipeStore()}={}){
  Object.assign(this,{library,cache,onChange,rigCache});this.values=new Map();this.versions=new Map();this.pending=new Set();this.ready=false;this.running=null;this.timer=null;this.message='Authoring changes wait for disk storage.';this.recoveries=[];
 }
 getItem(key){if(this.values.has(key))return this.values.get(key)==='null'?null:this.values.get(key);try{return this.cache?.getItem(key)??null;}catch{return null;}}
 setItem(key,raw){if(!KEYS[key])throw Error('Unknown authoring storage key.');JSON.parse(raw);this.values.set(key,raw);try{this.cache?.setItem(key,raw);}catch{}this.pending.add(key);this.message='Authoring changes pending disk save.';this.onChange();clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(()=>{}),350);}
 removeItem(key){this.setItem(key,'null');}
 async marker(key){try{return this.cache?.getItem('capp.3d-lab.disk.stamp.'+key);}catch{return null;}}
 async stamp(key,raw){try{this.cache?.setItem('capp.3d-lab.disk.stamp.'+key,await this.library.fingerprint(JSON.parse(raw)));}catch{}}
 async sync(){
  await this.library.ensureWritable();this.ready=false;clearTimeout(this.timer);if(this.running)await this.running.catch(()=>{});
  this.recoveries=[];
  for(const [key,name]of Object.entries(KEYS)){
   const raw=this.getItem(key);let remote=await this.library.client.request('settings/'+name);
   if(raw!==null){
    let value;try{value=JSON.parse(raw);}catch{throw Error('The browser '+name+' collection is damaged; its original was retained.');}
    const hash=await this.library.fingerprint(value),marker=await this.marker(key);
    if(hash!==marker||remote.fingerprint===null){remote=await this.library.client.request('settings/'+name,{method:'PUT',value:{value,migrate:true,expected:null}});if(remote.recovered)this.recoveries.push(remote.recovered);}
   }
   this.versions.set(key,remote.fingerprint);
   const next=remote.value===null?null:JSON.stringify(remote.value);
   if(this.getItem(key)===raw){this.values.set(key,next);if(next!==null){try{this.cache?.setItem(key,next);}catch{}await this.stamp(key,next);}this.pending.delete(key);}
  }
  let legacy=[];try{for(const row of await this.rigCache.list())legacy.push(await this.rigCache.get(row.id));}catch(error){this.recoveries.push('Browser rig recovery could not be read: '+error.message);}
  let rigs=await this.library.client.request('settings/rig-shelf');
  const current=Array.isArray(rigs.value)?rigs.value:[],byId=new Map(current.map(v=>[v.id,v]));let changed=false;
  for(const rig of legacy){const key='rig-'+rig.id,hash=await this.library.fingerprint(rig);if(await this.marker(key)===hash)continue;if(!byId.has(rig.id)){byId.set(rig.id,rig);changed=true;}else if(await this.library.fingerprint(byId.get(rig.id))!==hash){
    // Keep the canonical rig and also retain this conflicting browser recipe.
    const suffix=(await this.library.fingerprint(rig)).slice(0,12),id=('rig-recovered-'+suffix);
    if(!byId.has(id)){byId.set(id,{...rig,id,name:(rig.name.slice(0,95)+' (browser recovery)')});changed=true;}
  }}
  if(changed)rigs=await this.library.client.request('settings/rig-shelf',{method:'PUT',value:{value:[...byId.values()],expected:rigs.fingerprint}});
  this.rigs=rigs.value||[];this.rigVersion=rigs.fingerprint;for(const rig of legacy)await this.stamp('rig-'+rig.id,JSON.stringify(rig));
  this.ready=true;if(this.pending.size)await this.flush();this.message=this.recoveries.length?'Authoring data saved; conflicting browser copies retained in recovered/.':'Prompts, workflows, shape session and rig shelf are saved on disk.';this.onChange();
 }
 flush(){
  clearTimeout(this.timer);if(this.running)return this.running;
  this.running=(async()=>{
   if(!this.pending.size)return;
   if(!this.ready)throw Error('Authoring changes are cached only. Connect Asset storage to save them on disk.');
   await this.library.ensureWritable();
   while(this.pending.size){const key=this.pending.values().next().value,raw=this.values.get(key),result=await this.library.client.request('settings/'+KEYS[key],{method:'PUT',value:{value:JSON.parse(raw),expected:this.versions.get(key)}});
    this.versions.set(key,result.fingerprint);if(this.values.get(key)===raw){this.pending.delete(key);await this.stamp(key,raw);}
   }
   this.message='Authoring changes saved to disk.';
  })().catch(error=>{this.message='Authoring changes NOT saved to disk: '+error.message;throw error;}).finally(()=>{this.running=null;this.onChange();});
  return this.running;
 }
 async saveRigs(rigs){if(!this.ready)throw Error('Connect Asset storage before saving a rig recipe.');await this.library.ensureWritable();const result=await this.library.client.request('settings/rig-shelf',{method:'PUT',value:{value:rigs,expected:this.rigVersion}});this.rigs=result.value;this.rigVersion=result.fingerprint;return this.rigs;}
}
export class DiskRigRecipeStore{
 constructor(storage){this.storage=storage;}
 async list(){if(!this.storage.ready)return this.storage.rigCache.list();return (this.storage.rigs||[]).map(r=>({id:r.id,name:r.name,joints:r.actionDocument.joints.length,actions:r.actionDocument.clips.filter(c=>Object.values(c.tracks).some(k=>k.length)).length}));}
 async get(id){if(!this.storage.ready)return this.storage.rigCache.get(id);const rig=this.storage.rigs.find(r=>r.id===id);if(!rig)throw Error('Choose a saved rig.');return normalizeRigRecipe(rig);}
 async save(value){const rig=normalizeRigRecipe(value),rows=this.storage.rigs||[];await this.storage.saveRigs([...rows.filter(r=>r.id!==rig.id),rig]);try{await this.storage.rigCache.save(rig);await this.storage.stamp('rig-'+rig.id,JSON.stringify(rig));}catch{}return rig;}
 async remove(id){await this.storage.saveRigs(this.storage.rigs.filter(r=>r.id!==id));try{await this.storage.rigCache.remove(id);}catch{}}
 async close(){await this.storage.rigCache.close();}
}
