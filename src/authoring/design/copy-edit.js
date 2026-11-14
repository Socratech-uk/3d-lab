/** Copy preparation is pure. The host verifies source bytes and owns the
 * create-if-absent write; no copy operation can replace its source file. */
import { deepClone, normaliseSolModelDocument, solId, validateSolModelDocument } from '../src/model-format/sol-model-document.js';
import { isSolComponentDocument } from '../src/model-format/sol-component-library.js?v=1.1.0';
import { destinationFor, validModelDirectory } from './asset-workspace.js?v=1.4.0';

export function copyDocumentAllowsFolders(document) {
  return isSolComponentDocument(document);
}

/** Validate the editor's known schema without rebuilding authored JSON. Unknown
 * extension fields, geometry, behavior and animation references survive. */
export function createEditableCopy(sourceDocument, { name, source = {}, directory = '' } = {}) {
  const validation = validateSolModelDocument(normaliseSolModelDocument(sourceDocument));
  if (!validation.valid) throw new TypeError(validation.errors.join(' '));
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('Give the copy a name.');
  if (!validModelDirectory(directory)) throw new TypeError('Choose a safe copy folder.');
  const componentDocument = copyDocumentAllowsFolders(sourceDocument);
  if (directory && !componentDocument) throw new TypeError('Whole models and typed game assets must be copied to the project root.');
  const copy = deepClone(sourceDocument);
  if (!copy.meta || typeof copy.meta !== 'object' || Array.isArray(copy.meta)) throw new TypeError('Source model metadata is missing.');
  if (copy.meta.parameters != null && (typeof copy.meta.parameters !== 'object' || Array.isArray(copy.meta.parameters))) throw new TypeError('Source model parameters must be an object.');
  copy.meta.parameters ||= {};
  copy.meta.id = solId('model');
  copy.meta.name = name.trim();
  copy.meta.updatedAt = new Date().toISOString();
  const origin = {};
  for (const field of ['assetId', 'path']) if (typeof source?.[field] === 'string' && source[field]) origin[field] = source[field];
  if (source?.sha256 != null && source.sha256 !== '') {
    if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.sha256)) throw new TypeError('Source file SHA-256 must be a verified hash.');
    origin.sha256 = source.sha256;
  }
  // Scene subtree extraction creates a temporary intermediate model. Its host
  // supplies the real active document id rather than claiming that temporary id.
  const documentId = typeof source?.documentId === 'string' && source.documentId ? source.documentId : sourceDocument.meta.id;
  if (typeof documentId === 'string' && documentId) origin.documentId = documentId;
  copy.meta.parameters.copy = origin;
  if (componentDocument) {
    const component = copy.meta.parameters.component;
    copy.nodes.find(node => node.id === component.rootId).name = copy.meta.name;
    if (!component.libraryHierarchy || !directory.startsWith('components/ships/')) component.category = directory.split('/').slice(1).join('/') || 'uncategorised';
    // A copied object's geometry can be edited immediately. The original
    // sibling preview cannot authoritatively describe this new file.
    delete component.preview;
    delete component.previewGeometrySha256;
  }
  const copyValidation = validateSolModelDocument(normaliseSolModelDocument(copy));
  if (!copyValidation.valid) throw new TypeError(copyValidation.errors.join(' '));
  return copy;
}

export function copyDestination(filename, directory = '', assets = []) {
  const target = destinationFor(null, filename, assets, { directory });
  if (target.existing) throw new Error('A file already exists at this destination. Choose a new copy filename.');
  return { ...target, expectedSha256: 'absent' };
}

export function verifyCopyReceipt(receipt, target) {
  if (!receipt || receipt.ok !== true || receipt.path !== target.path || receipt.filename !== target.filename
    || (receipt.directory === undefined ? '' : receipt.directory) !== target.directory || receipt.assetId !== target.assetId
    || typeof receipt.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(receipt.sha256)) {
    throw new Error('The copy receipt did not match its requested destination.');
  }
  return true;
}
