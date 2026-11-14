import { modelById } from './models.mjs';
import { check, metadata, availableName, inspectGlb, digest, recipe } from './core.mjs';
import { normalizeActionDocument } from './action-document.mjs';
import { normalizeShapeDocument } from './shape-document.mjs';
const request = r => new Promise((resolve,reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
/** Separate identity and data from every Voice Lab store. New results are immutable assets. */
export class ModelLibrary {
  constructor({ indexedDB = globalThis.indexedDB, name = 'capp.3d-lab.assets.v1' } = {}) { this.idb = indexedDB; this.name = name; this.db = null; this.opening = null; }
  async open() {
    if (this.db) return this;
    if (!this.opening) this.opening = new Promise((resolve,reject) => {
      if (!this.idb) { reject(new Error('Local draft storage is unavailable. You can still download completed meshes.')); return; }
      const r = this.idb.open(this.name, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('assets', { keyPath: 'id' }); r.result.createObjectStore('files', { keyPath: 'id' }); };
      r.onerror = () => { this.opening = null; reject(r.error); };
      r.onblocked = () => reject(new Error('Close other 3D Lab windows before opening this draft library.'));
      r.onsuccess = () => { this.db = r.result; this.db.onversionchange = () => this.close(); resolve(this); };
    });
    return this.opening;
  }
  close() { this.db?.close(); this.db = null; this.opening = null; }
  async transaction(mode, action) {
    await this.open();
    return new Promise((resolve,reject) => {
      const tx = this.db.transaction(['assets','files'], mode); let value, failure;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject((failure || tx.error)?.name === 'QuotaExceededError' ? new Error('Draft storage is full. The result is retained; download it or free space and retry saving.') : failure || tx.error || new Error('Draft operation failed.'));
      tx.onerror = () => {};
      Promise.resolve().then(() => action(n => tx.objectStore(n))).then(v => { value = v; }, e => { failure = e; try { tx.abort(); } catch { reject(e); } });
    });
  }
  list() { return this.transaction('readonly', s => request(s('assets').getAll())); }
  async get(id) { return this.transaction('readonly', async s => { const [stored, files] = await Promise.all([request(s('assets').get(id)),request(s('files').get(id))]); check(stored && files?.glb, 'This asset is no longer available. Refresh the library.'); const {_diskCache,...asset}=stored;return { asset, files }; }); }
  async preview(id) { return this.transaction('readonly',async s=>{const files=await request(s('files').get(id));return files?.thumbnail||files?.image||null;}); }
  async save(options) {
    const create = await prepareAssetRecord(options);
    return this.transaction('readwrite', async s => {
      const result = create(await request(s('assets').getAll()));
      if(!result.existing){await request(s('files').add(result.files));await request(s('assets').add(result.asset));}
      return {asset:result.asset,renamed:result.renamed};
    });
  }
  async revise(options,id,revision){
    const old=await this.get(id);check(old.asset.revision===revision,'This asset changed. Reopen it before saving.');
    const {revisionRecord}=await import('./asset-lifecycle.mjs'),next=await revisionRecord(options,old,await this.list());
    await this.transaction('readwrite',async stores=>{const current=await request(stores('assets').get(id));check(current?.revision===revision,'This asset changed. Reopen it before saving.');await request(stores('assets').put(next.asset));await request(stores('files').put(next.files));});
    return {asset:next.asset,renamed:next.renamed};
  }
  putRecord({asset,files},{synced=false}={}) { return this.transaction('readwrite',async s=>{const {_diskCache,...clean}=asset;await request(s('files').put(files));await request(s('assets').put(synced?{...clean,_diskCache:{...files.diskStamp,metadata:JSON.stringify(clean)}}:clean));}); }
  async update(id, revision, value) {
    const meta = metadata(value);
    return this.transaction('readwrite', async s => {
      const row = await request(s('assets').get(id)); check(row?.revision === revision, 'This asset changed in another window. Reopen it before saving.');
      const rows = await request(s('assets').getAll());
      check(availableName(meta.title, rows.filter(r => r.id !== id), meta.folder) === meta.title, 'That name already exists in this folder. Choose a different name.');
      const {_diskCache,...clean}=row;const saved = { ...clean, ...meta, revision: revision + 1, updatedAt: new Date().toISOString() }; await request(s('assets').put(saved)); return saved;
    });
  }
  async thumbnail(id, blob) { check(blob instanceof Blob && blob.type === 'image/png' && blob.size <= 1024 ** 2, 'Invalid thumbnail.'); return this.transaction('readwrite', async s => { const row = await request(s('files').get(id)); if (!row) return;const stored=await request(s('assets').get(id));if(stored){const {_diskCache,...clean}=stored;await request(s('assets').put(clean));} await request(s('files').put({ ...row, thumbnail: blob })); }); }
  remove(id, revision) { return this.transaction('readwrite', async s => { const row = await request(s('assets').get(id)); check(row?.revision === revision, 'This asset changed. Refresh before deleting it.'); await request(s('files').delete(id)); await request(s('assets').delete(id)); }); }
}

/** Build an immutable revision independently of its persistence backend. */
export async function prepareAssetRecord({ bytes, info = {}, source = null, generation = null, origin = 'import', edit = null, shapeDocument = null, actionDocument = null, project = null }) {
    check(['generation','import','edit','shape','action'].includes(origin), 'Invalid asset origin.');
    check(origin === 'shape' || shapeDocument == null, 'Editable shape documents can only be saved with Shape Lab assets.');
    check(origin !== 'shape' || shapeDocument != null, 'Shape Lab assets need an editable shape document.');
    // Normalize and detach before the first await so the saved recipe is the
    // exact submitted revision even when the user continues editing during I/O.
    check((origin === 'action') === (actionDocument != null), 'Action drafts need their editable action document.');
    const action = origin === 'action' ? normalizeActionDocument(actionDocument) : null;
    const shape = origin === 'shape' ? normalizeShapeDocument(shapeDocument) : null;
    const inspected = inspectGlb(bytes), meta = metadata(info), sha256 = await digest(inspected.bytes);
    if (origin === 'generation') check(modelById(generation?.model) && source?.blob instanceof Blob, 'A generated asset needs its model and source image.');
    if (origin === 'edit') check(edit && typeof edit.parentId === 'string' && /^[a-f0-9]{64}$/.test(edit.parentSha256) && Array.isArray(edit.operations) && edit.operations.length <= 100 && edit.operations.every(o=>typeof o === 'string' && o.length <= 200), 'Edited drafts need valid parent provenance and a bounded edit history.');
    if(project)check(typeof project.id==='string'&&/^[a-z0-9._-]{1,80}$/.test(project.id)&&typeof project.assetId==='string'&&project.assetId.length<=250&&/^[a-f0-9]{64}$/.test(project.revision),'Invalid project revision identity.');
    const projectRef=project?{id:project.id,assetId:project.assetId,revision:project.revision}:null;
    const glb = new Blob([inspected.bytes], { type: 'model/gltf-binary' });
    return rows => {
      const title = availableName(meta.title, rows, meta.folder), now = new Date().toISOString(), id = crypto.randomUUID();
      const existing=projectRef&&rows.find(r=>r.project?.id===projectRef.id&&r.project?.revision===projectRef.revision&&r.sha256===sha256);
      if(existing)return {asset:existing,existing:true,renamed:false};
      const asset = { ...meta, title, id, revision: 1, origin, createdAt: now, updatedAt: now, sha256, byteLength: glb.size, vertices: inspected.vertices, triangles: inspected.triangles,
        recipe: generation ? recipe(generation) : null, result: generation ? { model: generation.model, modelRevision: String(generation.modelRevision || '').slice(0,120), deviceName: String(generation.deviceName || '').slice(0,160), generationMs: Number(generation.generationMs) || 0, ...(generation.conditioning ? {conditioning:conditioningSummary(generation.conditioning)} : {}) } : null,
        edit: origin === 'edit' ? { parentId: edit.parentId, parentSha256: edit.parentSha256, operations: [...edit.operations] } : null,
        action: action ? {version:action.version,joints:action.joints.length,clips:action.clips.length} : null,
        shape: shape ? { version: shape.version, parts: shape.parts.length } : null,
        source: source ? { name: source.name, width: source.width, height: source.height, sha256: source.sha256 } : null,project:projectRef };
      const files = { id, glb, image: source?.blob || null, views: Object.fromEntries(Object.entries(source?.views || {}).map(([key,view]) => [key,{blob:view.blob,name:view.name,width:view.width,height:view.height,sha256:view.sha256}])), shapeDocument: shape, actionDocument: action, thumbnail: null };
      return {asset,files,renamed:title!==meta.title};
    };
}

function conditioningSummary(value) {
  check(Number.isInteger(value.processorSize)&&value.processorSize>=32&&value.processorSize<=4096&&Array.isArray(value.views)&&value.views.length<=4, 'Invalid generation processing details.');
  check(Number.isFinite(value.imagePadding)&&value.imagePadding>=.05&&value.imagePadding<=.25, 'Invalid generation framing details.');
  const views=value.views.map(v=>{check(['front','left','back','right'].includes(v.view)&&[v.width,v.height].every(n=>Number.isInteger(n)&&n>0&&n<=1024),'Invalid generation view details.');return {view:v.view,width:v.width,height:v.height};});
  check(value.surfaceExtractor==='marching-cubes'&&value.geometryPostprocessing==='none','Unknown generation processing.');
  return {processorSize:value.processorSize,imagePadding:value.imagePadding,views,surfaceExtractor:value.surfaceExtractor,geometryPostprocessing:value.geometryPostprocessing};
}
