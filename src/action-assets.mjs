import {AssetPreviews} from './asset-previews.mjs';
import { filterAssets, key } from './core.mjs';
import { containDialogFocus } from './dialog-focus.mjs';

const origins = { action:'Action draft', generation:'Generated mesh', import:'Imported GLB', edit:'Builder edit', shape:'Shape Lab mesh' };
const bytesLabel = bytes => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil((bytes || 0) / 1024)} KiB`;
const count = value => Math.max(0, Number.isFinite(value) ? value : 0).toLocaleString();

/** Metadata only: browsing never parses or changes a working 3D scene. */
export function actionAssetSummary(asset) {
  const action = asset.origin === 'action' && asset.action;
  return {
    kind: origins[asset.origin] || 'Saved model',
    title: String(asset.title || 'Untitled model'),
    detail: action ? `${count(action.joints)} joints · ${count(action.clips)} saved actions` : `${count(asset.triangles)} triangles · ${bytesLabel(asset.byteLength)}`,
    intent: action ? 'Continue editing' : 'Open model',
    guidance: action
      ? 'Reopen the mesh, joints, weights and saved actions together. Your next save updates this asset and retains earlier revisions.'
      : asset.origin === 'shape'
        ? 'Open the saved mesh for rigging. Keep editing its shape recipe in Shape Lab; changes here are saved as a separate action draft.'
        : asset.origin === 'import'
          ? 'Open this GLB for rigging or continue with its supported skeleton and actions. The original file stays in Assets.'
          : 'Open an editable copy for rigging and animation. The original model stays in Assets.'
  };
}

export function actionAssetRows(rows, { query = '', folder = '', type = '', sort = 'recent' } = {}) {
  const filtered = filterAssets(rows, {query, folder, type});
  return sort === 'name'
    ? filtered.sort((a,b) => key(a.title).localeCompare(key(b.title)) || a.id.localeCompare(b.id))
    : filtered;
}

export class ActionAssetPicker {
  constructor({library, onOpen, onImport, getCurrentId = () => null}) {
    Object.assign(this, {library,onOpen,onImport,getCurrentId,rows:[],selectedId:null,page:0,pageSize:12,busy:false,loading:false,serial:0,thumbSerial:0,urls:new Set(),returnFocus:null});
    this.previews=new AssetPreviews(library);
    const dialog = document.createElement('dialog');
    dialog.id = 'action-asset-picker'; dialog.className = 'action-asset-picker';
    dialog.setAttribute('aria-labelledby','a-assets-heading');
    dialog.setAttribute('aria-describedby','a-assets-intro');
    dialog.innerHTML = `<header class="action-assets-heading"><div><span class="eyebrow">ACTION LAB · YOUR MODELS</span><h2 id="a-assets-heading">Choose a model to animate</h2></div><button id="a-assets-close" type="button" title="Close asset picker" aria-label="Close asset picker">×</button></header>
      <p id="a-assets-intro">Choose a saved model or import a GLB. Originals stay in Assets; action drafts keep their rig and saved movements.</p>
      <div class="action-assets-filters"><label class="action-assets-search">Search models<input id="a-assets-search" type="search" placeholder="Name, folder, tag or notes" maxlength="200" autocomplete="off"></label><label>Folder<select id="a-assets-folder"><option value="">All folders</option></select></label><label>Type<select id="a-assets-type"><option value="">All models</option><option value="action">Action drafts</option><option value="generation">Generated meshes</option><option value="import">Imported GLBs</option><option value="edit">Builder edits</option><option value="shape">Shape Lab meshes</option></select></label><label>Sort<select id="a-assets-sort"><option value="recent">Newest first</option><option value="name">Name A–Z</option></select></label></div>
      <div class="action-assets-meta"><span id="a-assets-count"></span><button id="a-assets-refresh" type="button" title="Reload saved assets">Refresh</button></div>
      <div class="action-assets-body"><section class="action-assets-results" aria-label="Saved models"><div id="a-assets-list" class="action-assets-list" role="group" aria-label="Choose a saved model"></div><div id="a-assets-empty" class="action-assets-empty" hidden><strong>No saved models yet</strong><p>Import a GLB here, or create and save a model in Create, Builder or Shape Lab.</p></div><nav class="action-assets-pages" aria-label="Model pages"><button id="a-assets-previous" type="button" title="Show previous models">← Previous</button><span id="a-assets-page"></span><button id="a-assets-next" type="button" title="Show next models">Next →</button></nav></section>
      <aside class="action-assets-selection" aria-label="Selected model"><span id="a-assets-selection-kind" class="eyebrow">YOUR NEXT ACTION</span><h3 id="a-assets-selection-title">Select a model</h3><p id="a-assets-selection-detail">Pick a card to see what will open.</p><p id="a-assets-selection-guide">A rig is a set of joints. Binding tells the mesh which joints to follow. Action Lab will guide you through both.</p><dl id="a-assets-selection-stats"></dl><p id="a-assets-selection-current" hidden>This is the model already open in Action Lab. Continue keeps your current edits.</p></aside></div>
      <p id="a-assets-status" class="action-assets-status" role="status" aria-live="polite"></p><footer class="action-assets-footer"><div><button id="a-assets-import" type="button" title="Import a self-contained GLB and open it in Action Lab">Import GLB…</button><span>Model, skeleton and supported actions</span><input id="a-assets-file" type="file" accept=".glb,model/gltf-binary" hidden></div><button id="a-assets-open" type="button" class="primary" title="Open the selected asset in Action Lab" disabled>Open in Action Lab →</button></footer>`;
    document.body.append(dialog); this.dialog = dialog; this.releaseFocus = containDialogFocus(dialog);
    this.$ = id => dialog.querySelector('#'+id);
    this.$('a-assets-close').onclick = () => this.close();
    dialog.addEventListener('cancel', event => {event.preventDefault();this.close();});
    dialog.addEventListener('close', () => {++this.serial;this.releaseThumbnails();this.returnFocus?.isConnected && this.returnFocus.focus();});
    for (const id of ['a-assets-search','a-assets-folder','a-assets-type','a-assets-sort']) this.$(id).addEventListener(id.endsWith('search') ? 'input' : 'change', () => {if(this.busy)return;this.page=0;this.render();});
    this.$('a-assets-refresh').onclick = () => this.refresh();
    this.$('a-assets-previous').onclick = () => {this.page--;this.render();};
    this.$('a-assets-next').onclick = () => {this.page++;this.render();};
    this.$('a-assets-open').onclick = () => this.openSelected();
    this.$('a-assets-import').onclick = () => {if(!this.busy)this.$('a-assets-file').click();};
    this.$('a-assets-file').onchange = () => {const file=this.$('a-assets-file').files[0];this.$('a-assets-file').value='';if(file)this.perform(()=>this.onImport(file),'Importing and checking model…');};
  }
  async open({returnFocus = document.activeElement, chooseFile = false} = {}) {
    if(this.busy)return false;
    if(!this.dialog.open){this.returnFocus=returnFocus;this.selectedId=this.getCurrentId();this.page=0;this.$('a-assets-search').value='';this.$('a-assets-folder').value='';this.$('a-assets-type').value='';this.dialog.showModal();}
    this.status('');this.$('a-assets-search').focus();
    // The native chooser must be invoked while the initiating click is still active.
    if(chooseFile)this.$('a-assets-file').click();
    await this.refresh();return true;
  }
  close() {if(this.busy)return false;if(this.dialog.open)this.dialog.close();return true;}
  dispose(){this.busy=false;this.close();this.releaseThumbnails();this.releaseFocus();this.dialog.remove();}
  status(message,error=false){const node=this.$('a-assets-status');node.textContent=message;node.classList.toggle('error',error);}
  async refresh() {
    if(!this.dialog.open || this.busy)return;
    const serial=++this.serial;this.loading=true;this.status('Loading your saved models…');this.updateControls();
    try{
      const rows=await this.library.list();if(serial!==this.serial||!this.dialog.open)return;
      this.rows=rows;const folders=[...new Set(rows.map(r=>r.folder).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
      const selected=this.$('a-assets-folder').value;this.$('a-assets-folder').replaceChildren(new Option('All folders',''),...folders.map(f=>new Option(f,f)));if(folders.includes(selected))this.$('a-assets-folder').value=selected;
      if(!rows.some(r=>r.id===this.selectedId))this.selectedId=null;
      this.loading=false;this.status('');this.render();
    }catch(error){if(serial===this.serial&&this.dialog.open){this.loading=false;this.status(error.message||'Could not load saved models. Try Refresh.',true);this.updateControls();}}
  }
  releaseThumbnails(){this.previews.reset();++this.thumbSerial;for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();}
  render() {
    if(!this.dialog.open)return;
    this.releaseThumbnails();const thumbSerial=this.thumbSerial;
    const filtered=actionAssetRows(this.rows,{query:this.$('a-assets-search').value,folder:this.$('a-assets-folder').value,type:this.$('a-assets-type').value,sort:this.$('a-assets-sort').value});
    const pages=Math.max(1,Math.ceil(filtered.length/this.pageSize));this.page=Math.min(pages-1,Math.max(0,this.page));
    if(this.selectedId&&!filtered.some(r=>r.id===this.selectedId))this.selectedId=null;
    this.$('a-assets-count').textContent=`${filtered.length} model${filtered.length===1?'':'s'}${filtered.length!==this.rows.length?' of '+this.rows.length:''}`;
    this.$('a-assets-page').textContent=`Page ${this.page+1} of ${pages}`;
    this.$('a-assets-previous').dataset.unavailable=String(this.page===0);this.$('a-assets-next').dataset.unavailable=String(this.page===pages-1);
    const list=this.$('a-assets-list');list.replaceChildren();
    const pageRows=filtered.slice(this.page*this.pageSize,(this.page+1)*this.pageSize);
    for(const row of pageRows){
      const summary=actionAssetSummary(row),card=document.createElement('button');card.type='button';card.className='action-assets-card';card.dataset.assetId=row.id;card.title=`Select ${summary.title}. Double-click or press Enter to open.`;
      card.setAttribute('aria-pressed',String(this.selectedId===row.id));card.setAttribute('aria-label',`${summary.title}, ${summary.kind}, ${summary.detail}`);
      const preview=document.createElement('span');preview.className='action-assets-thumbnail';preview.setAttribute('aria-hidden','true');preview.textContent=row.origin==='action'?'◎':'◇';
      const label=document.createElement('span');label.className='action-assets-card-label';const name=document.createElement('strong');name.textContent=summary.title;const kind=document.createElement('small');kind.textContent=summary.kind+(row.id===this.getCurrentId()?' · OPEN':'');const details=document.createElement('small');details.textContent=summary.detail;label.append(name,kind,details);card.append(preview,label);
      card.onclick=()=>{if(!this.busy){this.selectedId=row.id;this.renderSelection();this.status('');}};
      card.ondblclick=()=>{if(!this.busy){this.selectedId=row.id;this.openSelected();}};
      card.onkeydown=event=>{
        if(this.busy)return;
        if(event.key==='Enter'){event.preventDefault();this.selectedId=row.id;this.openSelected();return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
        event.preventDefault();const cards=[...list.querySelectorAll('button[data-asset-id]')],index=cards.indexOf(card),cols=Math.max(1,getComputedStyle(list).gridTemplateColumns.split(' ').length);
        const next=event.key==='Home'?0:event.key==='End'?cards.length-1:Math.min(cards.length-1,Math.max(0,index+({ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols}[event.key])));
        this.selectedId=cards[next].dataset.assetId;this.renderSelection();cards[next].focus();
      };
      list.append(card);
      this.previews.watch(card,row.id,preview);
    }
    const empty=this.$('a-assets-empty');empty.hidden=filtered.length>0;empty.querySelector('strong').textContent=this.rows.length?'No models match your filters':'No saved models yet';empty.querySelector('p').textContent=this.rows.length?'Try another name, folder or type, or import a GLB.':'Import a GLB here, or create and save a model in Create, Builder or Shape Lab.';
    this.renderSelection();
  }
  renderSelection(){
    const row=this.rows.find(r=>r.id===this.selectedId),summary=row&&actionAssetSummary(row),current=row&&row.id===this.getCurrentId();
    for(const card of this.$('a-assets-list').querySelectorAll('[data-asset-id]'))card.setAttribute('aria-pressed',String(card.dataset.assetId===this.selectedId));
    this.$('a-assets-selection-kind').textContent=summary?.kind||'YOUR NEXT ACTION';this.$('a-assets-selection-title').textContent=summary?.title||'Select a model';
    this.$('a-assets-selection-detail').textContent=summary?.detail||'Pick a card to see what will open.';
    this.$('a-assets-selection-guide').textContent=summary?.guidance||'A rig is a set of joints. Binding tells the mesh which joints to follow. Action Lab will guide you through both.';
    this.$('a-assets-selection-current').hidden=!current;
    const stats=this.$('a-assets-selection-stats');stats.replaceChildren();
    if(row){const date=new Date(row.createdAt);for(const [label,value] of [['Folder',row.folder||'Unfiled'],['Triangles',count(row.triangles)],['File size',bytesLabel(row.byteLength)],['Saved',Number.isFinite(date.getTime())?date.toLocaleDateString():'Unknown'],...(row.tags?.length?[['Tags',row.tags.join(', ')]]:[])]){const term=document.createElement('dt'),definition=document.createElement('dd');term.textContent=label;definition.textContent=value;stats.append(term,definition);}}
    this.$('a-assets-open').textContent=current?'Continue current session →':row?.origin==='action'?'Continue in Action Lab →':'Open in Action Lab →';this.updateControls();
  }
  updateControls(){
    this.dialog.setAttribute('aria-busy',String(this.busy||this.loading));
    for(const control of this.dialog.querySelectorAll('button,input,select'))control.disabled=this.busy||(this.loading&&!['a-assets-close','a-assets-import','a-assets-file'].includes(control.id));
    this.$('a-assets-open').disabled=this.busy||this.loading||!this.selectedId;
    for(const id of ['a-assets-previous','a-assets-next'])this.$(id).disabled=this.busy||this.loading||this.$(id).dataset.unavailable==='true';
  }
  openSelected(){const id=this.selectedId;if(!id)return Promise.resolve(false);return this.perform(()=>this.onOpen(id),'Checking model and opening Action Lab…');}
  async perform(operation,message){
    if(this.busy)return false;
    this.busy=true;this.status(message);this.updateControls();
    try{const opened=await operation();this.busy=false;if(opened!==false){this.close();return true;}this.status('Kept your current session. Choose another model or close this picker.');return false;}
    catch(error){this.status(error.message||'The model could not be opened. Your current session is unchanged.',true);return false;}
    finally{this.busy=false;if(this.dialog.open){this.updateControls();this.$('a-assets-open').focus();}}
  }
}
