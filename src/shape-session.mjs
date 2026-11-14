import { normalizeShapeDocument, parseShapeDocumentJSON } from './shape-document.mjs';

export const SHAPE_SESSION_KEY = 'capp.3d-lab.shapes.v1';
export const SHAPE_SESSION_MAX_BYTES = 2 * 1024 * 1024;

function checkSize(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > SHAPE_SESSION_MAX_BYTES) {
    throw new Error('This Shape Lab session exceeds the 2 MiB local session limit. Download its editable document to keep it.');
  }
  return text;
}

/** An editable work-in-progress, separate from immutable saved mesh assets. */
export class ShapeSessionStore {
  constructor(options = {}) {
    // A blocked storage getter must not prevent the editor itself opening.
    if (Object.hasOwn(options, 'storage')) this.storage = options.storage;
    else { try { this.storage = globalThis.localStorage; } catch { this.storage = null; } }
    this.key = options.key ?? SHAPE_SESSION_KEY;
  }
  load() {
    if (!this.storage) throw new Error('Local Shape Lab session storage is unavailable.');
    let text;
    try { text = this.storage.getItem(this.key); }
    catch { throw new Error('This browser could not read the local Shape Lab session.'); }
    if (text == null) return null;
    try { return parseShapeDocumentJSON(checkSize(text)); }
    catch (error) { throw new Error(`The local Shape Lab session could not be restored: ${error.message}`); }
  }
  save(document) {
    if (!this.storage) throw new Error('Local Shape Lab session storage is unavailable. Download its editable document to keep it.');
    const normalized = normalizeShapeDocument(document);
    const text = checkSize(JSON.stringify(normalized));
    try { this.storage.setItem(this.key, text); }
    catch (error) {
      if (error?.name === 'QuotaExceededError') throw new Error('Local Shape Lab session storage is full. Your current shape remains open; download its editable document to keep it.');
      throw new Error('This browser could not save the local Shape Lab session. Your current shape remains open; download its editable document to keep it.');
    }
  }
  clear() {
    if (!this.storage) return;
    try { this.storage.removeItem(this.key); }
    catch { throw new Error('This browser could not clear the local Shape Lab session.'); }
  }
}
