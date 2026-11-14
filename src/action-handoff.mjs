import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { check, inspectGlb } from './core.mjs';
import { extractActionScene, buildActionScene } from './action-geometry.mjs';
import { disposeComponent } from './builder-objects.mjs';
import { containDialogFocus } from './dialog-focus.mjs';

/** Decode and validate in isolation. Failed imports never touch the shared viewer. */
export async function prepareActionAsset(bytes, record) {
  const inspected = inspectGlb(bytes), manager = new THREE.LoadingManager();
  manager.setURLModifier(url => { check(url.startsWith('blob:'), 'External model resources are disabled.'); return url; });
  const buffer = inspected.bytes.buffer.slice(inspected.bytes.byteOffset, inspected.bytes.byteOffset + inspected.bytes.byteLength);
  const gltf = await new GLTFLoader(manager).parseAsync(buffer, '');
  let value, testRig;
  try {
    gltf.scene.animations = gltf.animations;
    check(gltf.animations.length <= 32, 'This model has more than 32 animation clips. Export a copy with the actions you need before opening it in Action Lab.');
    gltf.scene.traverse(node => { if (node.isMesh && node.userData.builderHidden) node.visible = false; });
    let embedded = null;
    gltf.scene.traverse(node => { if (node.userData.cappActionDocument) embedded = node.userData.cappActionDocument; });
    const saved = record.files.actionDocument || embedded;
    value = extractActionScene(gltf.scene, saved, record.asset.title.slice(0,160));
    if (!saved) value.document.source = record.asset.id ? { id: record.asset.id, sha256: record.asset.sha256 } : null;
    value.assignImportedSource = !saved && !record.asset.id;
    testRig = buildActionScene(value.base, value.document);
    const bounds = new THREE.Box3().setFromObject(testRig.root), size = bounds.getSize(new THREE.Vector3());
    check(!bounds.isEmpty() && size.toArray().every(Number.isFinite) && Math.max(...size.toArray()) > 1e-10, 'The model has invalid or empty geometry.');
    return value;
  } catch (error) {
    if (value?.base) disposeComponent(value.base);
    throw error;
  } finally {
    if (testRig) { testRig.skeleton.dispose(); disposeComponent(testRig.root); }
    gltf.scene.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    disposeComponent(gltf.scene);
  }
}

/** No navigation occurs until a successful save or explicit discard. */
export function confirmActionReplacement(actionLab, targetName) {
  if (!actionLab?.base || !actionLab.dirty) return Promise.resolve(true);
  const dialog = document.getElementById('action-switch-dialog');
  const save = document.getElementById('action-switch-save'), discard = document.getElementById('action-switch-discard'), cancel = document.getElementById('action-switch-cancel');
  const error = document.getElementById('action-switch-error');
  document.getElementById('action-switch-message').textContent = `“${actionLab.document.title}” has unsaved rig, weight or action edits. Save your changes before opening “${targetName}”? Earlier saved revisions remain recoverable.`;
  error.hidden = true; error.textContent = ''; dialog.returnValue = '';
  let saving = false;
  return new Promise(resolve => {
    const releaseFocus=containDialogFocus(dialog);
    const cleanup = () => { releaseFocus(); save.removeEventListener('click', saveClick); dialog.removeEventListener('cancel', onCancel); };
    const onCancel = event => { if (saving) event.preventDefault(); };
    const saveClick = async () => {
      saving = true; save.disabled = discard.disabled = cancel.disabled = true; error.hidden = true;
      try { await actionLab.save(); dialog.close('saved'); }
      catch (reason) { error.textContent = `Could not save: ${reason.message || reason}. Your working scene is still open.`; error.hidden = false; }
      finally { saving = false; save.disabled = discard.disabled = cancel.disabled = false; }
    };
    save.addEventListener('click', saveClick); dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', () => { cleanup(); resolve(['saved', 'discard'].includes(dialog.returnValue)); }, { once: true });
    dialog.showModal(); cancel.focus();
  });
}
