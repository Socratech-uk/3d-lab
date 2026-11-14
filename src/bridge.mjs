/** Scoped consumer, following the supplied Voice Lab bridge ownership pattern.
 * This new capability must be delivered by the rebuilt cApp Local AI Sidecar.
 * No parent-window access, native IPC, HTTP fallback or application-owned model downloads.
 */
export class ThreeLabBridge {
  constructor(scope = globalThis) { this.scope = scope; this.api = null; this.client = null; }
  local() {
    this.scope.__CAPP_REFRESH_LOCAL_AI_APP__?.();
    const api = this.scope.capp?.ai?.local;
    if (!api) throw new Error('Open the installed 3D Lab with Local AI selected to use image-to-3D. Import and preview work here.');
    if (this.api && this.api !== api) throw new Error('The Local AI provider changed. Reload 3D Lab before continuing.');
    this.api = api; return api;
  }
  connect() {
    const api = this.local();
    if (this.client) return this.client;
    if (typeof api.models3d?.connect !== 'function') throw new Error('3D generation is not available in this Local AI package. The cApp 3D sidecar update is required.');
    this.client = api.models3d.connect({ protocol: 'capp.local-models3d.v1', clientName: '3D Lab · image to 3D' });
    for (const method of ['status','prepare','render','cancel','dispose']) if (typeof this.client?.[method] !== 'function') { this.client = null; throw new Error('The 3D generation connection is incomplete. Update and rebuild the package.'); }
    return this.client;
  }
  async invoke(method, options) {
    try { return await this.connect()[method](options); }
    catch (error) {
      const text = String(error?.message || error);
      const messages = [
        [/models3d_setup_pending/, 'This model is listed, but its runtime is not packaged yet. See the selected model’s setup note.'],
        [/models3d_cuda_required/, 'This model requires an NVIDIA CUDA GPU. TripoSR also supports CPU.'],
        [/models3d_views_required/, 'Add a matching side or back image for the multiview model.'],
        [/models3d_engine_not_bundled/, 'Enable TripoSR + advanced shape models in Local AI, then freshly Compile and Package.'],
        [/models3d_access_denied/, 'Enable Scoped 3D generation in Local AI, then freshly Compile and Package 3D Lab.'],
        [/models3d_not_prepared/, 'Use Download & load model before generating.'],
        [/(models3d|dialogue)_cancelled/, 'Generation cancelled. Saved drafts are retained.'],
        [/(models3d|dialogue)_busy/, 'Another audio or 3D authoring operation is running. Wait or stop it first.'],
        [/models3d_cuda_unavailable|models3d_cuda_probe_failed/, 'The NVIDIA GPU is unavailable to the engine. Choose CPU or check your NVIDIA driver.'],
        [/models3d_(resolution|guidance|memory_mode|chunks)_invalid|models3d_hunyuan_controls_invalid|models3d_request_invalid/, 'The selected generation settings are unsupported. Update cApp and freshly Compile / Package 3D Lab with Local AI 0.22 or newer.'],
        [/out.of.memory/i, 'There is not enough memory. Try CPU offload, a smaller decode batch or 128 / 256 detail for Hunyuan. Unload other local models or select a smaller model. TripoSR also supports CPU.'],
        [/models3d_model_(checksum|missing)|dialogue_download_(hash|size|incomplete)/, 'The model files could not be verified. Use Download & load model to retry.'],
        [/dialogue_timeout/, 'The operation timed out and its worker was stopped. You can retry.']
      ];
      throw new Error(messages.find(([pattern]) => pattern.test(text))?.[1] || text);
    }
  }
  status() { return this.invoke('status'); }
  prepare(options) { return this.invoke('prepare', options); }
  render(options) { return this.invoke('render', options); }
  cancel() { return this.client ? this.invoke('cancel') : Promise.resolve({ cancelled: false }); }
  openStudio() { const api = this.local(); if (typeof api.openStudio !== 'function') throw new Error('Engine settings are only available in the installed cApp.'); return api.openStudio(); }
  dispose() { return this.client?.dispose(); }
}
