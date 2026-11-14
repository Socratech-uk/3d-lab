import {localFiles,waitForLocalFiles} from './local-files.mjs';
export function mountStoragePanel({library,authoring,initialLink=null,onConnected=async()=>{}}){
 const dialog=document.createElement('dialog');dialog.className='storage-dialog';dialog.id='asset-storage-dialog';dialog.setAttribute('aria-labelledby','asset-storage-title');
 dialog.innerHTML=`<div class="storage-heading"><div><span class="eyebrow">PERMANENT ASSETS</span><h2 id="asset-storage-title">Your drafts belong on disk.</h2></div><button id="storage-close" title="Close asset storage settings">×</button></div>
 <p>Models, rigs, actions and references are saved together as ordinary files. The browser keeps a cache.</p>
 <label class="field">Permanent folder<input id="storage-root" readonly value="C:\\Users\\alex1\\cApp\\assets\\3d"></label>
 <div class="storage-buttons"><button id="storage-copy-link">Copy connection for Foundry</button><button id="storage-copy-root" title="Copy the permanent assets folder path">Copy folder path</button></div>
 <div class="storage-buttons"><button id="storage-local" class="primary">Use local assets</button><button id="storage-retry">Retry / refresh</button></div>
 <details><summary>Advanced · remote storage</summary><p>Connect another machine or an existing storage service. Local folders connect automatically in the installed app.</p>
 <label class="field">Private storage connection link<input id="storage-link" type="password" autocomplete="off" placeholder="https://…/#storage=…"></label>
 <button id="storage-connect">Connect remote & migrate</button></details>
 <p id="storage-detail" role="status" aria-live="polite"></p><p id="storage-authoring" role="status"></p><ul id="storage-failures"></ul>
 <details><summary>What is kept?</summary><p>Each draft contains model.glb, asset.json, action.json or shape.json when applicable, and the original reference images. Saved prompts, workflows and rig recipes live in settings/. Earlier revisions and removed drafts remain on disk for recovery.</p><p>Migration verifies file checksums before marking a browser copy as backed up. It never clears the old database. A conflicting browser version is kept separately. Unsaved editor changes still need Save draft.</p></details>`;
 document.body.append(dialog);const $=id=>document.getElementById(id),button=$('asset-storage-open');
 let busy=false;
 function render(){const state=library.status();button.textContent=state.mode==='ready'?'Assets on disk':state.mode==='migrating'?'Migrating assets…':'Asset storage';button.dataset.state=state.mode;button.title=state.message;
  $('storage-status').textContent=state.mode==='migrating'?'Migrating browser drafts…':state.pending?'Saving draft to disk…':state.failures.length?state.failures.length+' browser drafts need migration':state.mode==='ready'?(authoring.pending.size?'Authoring changes not yet saved to disk':'Drafts on disk'):'Browser cache · disk save unavailable';$('storage-status').title=state.message;
  if(state.root)$('storage-root').value=state.root;
  $('storage-detail').textContent=state.message;$('storage-authoring').textContent=authoring.message;
  $('storage-failures').replaceChildren(...[...state.failures.map(r=>r.title+': '+r.error),...authoring.recoveries].map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
  $('storage-connect').disabled=$('storage-retry').disabled=busy||!!state.pending||state.mode==='migrating';
 }
 library.onChange=render;authoring.onChange=()=>{render();document.dispatchEvent(new CustomEvent('draft-storage-status'));};
 const connect=async link=>{if(busy)return;busy=true;render();try{clearTimeout(authoring.timer);if(authoring.running)await authoring.running.catch(()=>{});authoring.ready=false;await library.connect(link);await authoring.sync();await onConnected();}catch(error){library.report('error',error.message);}finally{busy=false;render();}};
 button.onclick=()=>{render();dialog.showModal();};$('storage-close').onclick=()=>dialog.close();$('storage-local').onclick=()=>void connect('capp-local:model');
 $('storage-copy-link').onclick=async()=>{try{if(!library.client.connection)throw Error('Connect asset storage first.');if(library.client.connection.local){$('storage-detail').textContent='Foundry uses the same shared folder automatically.';return;}await navigator.clipboard.writeText(library.client.connection.link);$('storage-detail').textContent='Private link copied. In Foundry, open Asset libraries and paste it there.';}catch(error){$('storage-detail').textContent=error.message;}};
 $('storage-copy-root').onclick=async()=>{try{await navigator.clipboard.writeText($('storage-root').value);}catch{$('storage-root').select();}};
 $('storage-connect').onclick=()=>{const link=$('storage-link').value;$('storage-link').value='';void connect(link);};
 $('storage-retry').onclick=()=>void connect(library.client.connection?.link||$('storage-link').value);
 render();
 return {render,connect,dialog,async start(){let link;try{link=library.connectionStorage?.getItem('capp.3d-lab.disk.connection.v1');}catch{}
  if(location.hash.startsWith('#storage=')){link=location.origin+'/'+location.hash;history.replaceState(null,'',location.pathname);}
  const native=await waitForLocalFiles();if(native)link='capp-local:model';
  if(initialLink)link=initialLink;
  if(link)await connect(link);
 }};
}
