import { ProjectWorkspace } from './project-workspace.mjs';
import { inspectGlb, prepareImage } from './core.mjs';

async function packReference(source,blob){if(!source||!blob)return null;const bytes=new Uint8Array(await blob.arrayBuffer());let raw='';for(let n=0;n<bytes.length;n+=16384)raw+=String.fromCharCode(...bytes.subarray(n,n+16384));return {...source,type:blob.type,data:btoa(raw)};}
async function unpackReference(value){if(!value)return null;const raw=atob(value.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));return prepareImage(new File([bytes],value.name||'reference.png',{type:value.type}));}
export function createProjectWorkspace({library,refresh,openAsset,openActionAsset,openShapeAsset,beforeOpen=async()=>{}}){
  return new ProjectWorkspace({lab:'3d',listLocal:async()=> (await library.list()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(a=>({id:a.id,title:a.title})),
    uploadLocal:async id=>{const {asset,files}=await library.get(id);const recipe={actionDocument:files.actionDocument||null,shapeDocument:files.shapeDocument||null,reference:await packReference(asset.source,files.image),views:{}};for(const [key,value]of Object.entries(files.views||{}))recipe.views[key]=await packReference(value,value.blob);return {blob:files.glb,kind:'model',metadata:{title:asset.title,origin:asset.origin,source:asset},recipe};},
    openModel:async({blob,metadata,recipe,revision,asset,project})=>{await beforeOpen();const bytes=new Uint8Array(await blob.arrayBuffer());inspectGlb(bytes);const action=recipe?.actionDocument,shape=recipe?.shapeDocument,source=await unpackReference(recipe?.reference);if(source){source.views={};for(const [key,value]of Object.entries(recipe?.views||{}))source.views[key]=await unpackReference(value);}
      const saved=await library.save({bytes,info:{title:(metadata.title||asset.name).slice(0,160),folder:project.name.replace(/[\\/:*?"<>|]/g,'-').slice(0,120),tags:['project:'+project.id],notes:'Project asset '+asset.id+' · Revision '+revision.id},origin:action?'action':shape?'shape':'import',actionDocument:action||null,shapeDocument:shape||null,source,project:{id:project.id,assetId:asset.id,revision:revision.id}});await refresh();
      if(action||revision.animated)await openActionAsset(saved.asset.id);else if(shape)await openShapeAsset(saved.asset.id);else await openAsset(saved.asset.id);
    }});
}
