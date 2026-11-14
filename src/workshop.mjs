import { modelById } from './models.mjs';
import { check, recipe, decode64, inspectGlb, LIMITS, metadata } from './core.mjs';
export class ModelWorkshop {
  constructor(bridge, library, onChange = () => {}) { this.bridge = bridge; this.library = library; this.onChange = onChange; this.busy = false; this.stopping = false; this.stage = ''; this.progress = null; this.status = null; this.unsaved = null; this.message = ''; this.error = ''; }
  notify() { this.onChange(this); }
  async checkStatus() { this.status = await this.bridge.status(); this.notify(); return this.status; }
  async operation(stage, fn) {
    check(!this.busy, 'Wait for the current operation to finish.'); this.busy = true; this.stopping = false; this.stage = stage; this.error = ''; this.progress = null; this.notify();
    try { return await fn(); } catch (e) { this.error = String(e?.message || e); throw e; }
    finally { this.busy = false; this.stopping = false; this.stage = ''; this.progress = null; this.notify(); }
  }
  onProgress = value => { this.progress = value && typeof value === 'object' ? { stage: String(value.stage || '').slice(0,160), message: String(value.message || '').slice(0,300), fraction: Number.isFinite(value.fraction) ? Math.max(0,Math.min(1,value.fraction)) : null } : null; this.notify(); };
  async prepare(settings, accepted) {
    check(accepted === true, 'Accept the model licence before downloading.');
    const options = recipe(settings);
    check(modelById(options.model).runtimeReady !== false, modelById(options.model).setupReason);
    return this.operation('Preparing model', async () => { const result = await this.bridge.prepare({ model: options.model, device: options.device, ...(options.memoryMode?{memoryMode:options.memoryMode}:{}), acceptLicense: true, onProgress: this.onProgress }); this.message = 'Model prepared' + (result.deviceName ? ` · ${result.deviceName}` : ''); await this.checkStatus(); return result; });
  }
  async generate({ source, settings, info }) {
    check(!this.unsaved, 'Save or download the retained result before starting another generation.');
    check(source?.blob instanceof Blob && source.blob.size <= LIMITS.imageBytes && source.imagePng, 'Choose a reference image first.');
    const options = recipe(settings), meta = metadata(info), spec = modelById(options.model);
    check(spec.runtimeReady !== false, spec.setupReason);
    const views = spec.multiview ? Object.fromEntries(Object.entries(source.views || {}).map(([key,view]) => {
      check(['left','right','back'].includes(key) && view?.blob instanceof Blob && view.blob.size <= LIMITS.imageBytes && view.imagePng, 'Choose valid side and back references.');
      return [key,view.imagePng];
    })) : null;
    check(!spec.multiview || Object.keys(views).length > 0, 'Add at least one side or back reference for the multiview model.');
    return this.operation('Generating mesh', async () => {
      if(this.library.ensureWritable)await this.library.ensureWritable();
      const result = await this.bridge.render({ ...options, imagePng: source.imagePng, ...(views ? {views} : {}), onProgress: this.onProgress });
      check(result?.model === options.model && result.resolution === options.resolution, 'The engine result does not match the requested model and detail level.');
      if(spec.id.startsWith('hunyuan3d-'))check(['guidanceScale','memoryMode','numChunks','seed','steps'].every(key=>result[key]===options[key]), 'The engine did not confirm the requested Hunyuan settings. Update cApp and freshly Compile / Package this app.');
      if(options.imagePadding!==undefined)check(result.imagePadding===options.imagePadding, 'The engine did not confirm reference framing. Rebuild cApp and freshly Compile / Package this app.');
      const bytes = decode64(result.modelGlb);
      this.unsaved = { bytes, info: meta, source, generation: { ...result, modelGlb: undefined, ...options }, origin: 'generation' }; this.notify();
      try { inspectGlb(bytes); }
      catch(error) { this.unsaved.validationError=String(error.message||error);this.notify();throw error; }
      return this.saveRetained();
    });
  }
  async saveRetained() {
    check(this.unsaved, 'There is no retained result to save.');
    check(!this.unsaved.validationError, 'Download the original result for recovery, then discard it before generating again. '+(this.unsaved.validationError||''));
    const saved = await this.library.save(this.unsaved); this.unsaved = null;
    this.message = saved.renamed ? `Saved as “${saved.asset.title}” to keep both assets.` : `Saved “${saved.asset.title}” to Drafts.`; this.notify(); return saved;
  }
  discardRetained() {check(!this.busy,'Wait for the current operation to finish.');check(this.unsaved,'There is no retained result.');this.unsaved=null;this.notify();}
  async cancel() { if (!this.busy || this.stopping) return; this.stopping = true; this.notify(); try { await this.bridge.cancel(); } catch (e) { this.stopping = false; this.error = String(e.message || e); this.notify(); throw e; } }
}
