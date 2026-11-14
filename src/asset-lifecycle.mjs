import {prepareAssetRecord} from './library.mjs';
import {check} from './core.mjs';

export async function revisionRecord(options,old,rows,prepared=null){
  const create=prepared||await prepareAssetRecord(options),next=create(rows.filter(a=>a.id!==old.asset.id));
  check(!next.renamed,'That name already exists in this folder. Choose a different name or duplicate the asset.');
  check(!next.existing,'Open the current asset before saving a revision.');
  const id=old.asset.id;
  next.asset={...old.asset,...next.asset,id,revision:old.asset.revision+1,createdAt:old.asset.createdAt,
    project:options.project??old.asset.project??null,recipe:next.asset.recipe??old.asset.recipe,result:next.asset.result??old.asset.result,
    workPackage:options.workPackage??old.asset.workPackage??false,workNotes:String(options.workNotes??old.asset.workNotes??'').slice(0,4000)};
  next.files.id=id;
  if(!options.source){next.asset.source=old.asset.source;next.files.image=old.files.image;next.files.views=old.files.views||{};}
  next.files.thumbnail=old.files.thumbnail||null;
  return next;
}

export function identityChoice(title,current){
  if(title===current)return Promise.resolve('rename');
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='identity-dialog';
    const h=document.createElement('h2');h.textContent='Keep this asset or make a copy?';
    const p=document.createElement('p');p.textContent='Save “'+title+'” with the same identity, or create a separate asset. Earlier saved revisions remain recoverable.';
    dialog.append(h,p);
    const finish=value=>{dialog.close();dialog.remove();resolve(value);};
    for(const [label,value]of [['Rename and save','rename'],['Duplicate and rename','duplicate'],['Cancel','cancel']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>finish(value);dialog.append(b);}
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish('cancel');});document.body.append(dialog);dialog.showModal();
  });
}

export async function saveAsset(library,options,record,{duplicate=false}={}){
  if(!record?.asset?.id||duplicate)return library.save(options);
  const choice=await identityChoice(options.info?.title||record.asset.title,record.asset.title);
  check(choice!=='cancel','Save cancelled. Your edits are retained.');
  return choice==='duplicate'?library.save(options):library.revise(options,record.asset.id,record.asset.revision);
}
