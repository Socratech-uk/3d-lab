import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createDefaultShapeRecipe, buildShapeGeometry } from './authoring/src/model-format/sol-shape-profile.js';
import { inspectGlb, check } from './core.mjs';
import {studioEnvironment} from './viewer-studio.mjs';

// Canonical materials never receive inspection-only clay, flat or wireframe changes.
const appearances = new WeakMap();
const materialList = material => [material].flat().filter(Boolean);
function resources(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    const appearance = appearances.get(node);
    for (const material of [node.material, appearance?.original, appearance?.display, appearance?.clay].flat().filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}
function dispose(object, retained = null) {
  const owned = resources(object), keep = resources(retained);
  for (const name of ['geometries', 'materials', 'textures']) for (const value of owned[name]) if (!keep[name].has(value)) value.dispose();
  // Texture clones intentionally share immutable raster data with undo snapshots.
  // Disposing GPU handles must never close their shared ImageBitmap source.
}
function modelBounds(object) {
  object.updateWorldMatrix(true, true);
  const parentInverse = object.parent ? object.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const bounds = new THREE.Box3();
  object.traverse(node => {
    if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
    node.geometry.computeBoundingBox();
    bounds.union(node.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(parentInverse, node.matrixWorld)));
  });
  return bounds;
}

const NAV_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const UNIT_Z = new THREE.Vector3(0, 0, 1), WORLD_UP = new THREE.Vector3(0, 1, 0);
function isEditable(node) { return Boolean(node?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]')); }
function activeModal() { return [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')].some(node => !node.hidden && node.getClientRects().length); }
function selectable(node, options, root) {
  if (!node.isMesh || (options.ignoreProjections !== false && node.userData.cappReferenceProjection)) return false;
  let selected = !options.selectedObject;
  for (let parent = node; parent; parent = parent.parent) {
    if (!parent.visible || (options.includeLocked !== true && parent.userData.builderLocked)) return false;
    if (parent === options.selectedObject) selected = true;
    if (parent === root) break;
  }
  return selected;
}

// These cursor resources live in the viewer scene, never in the editable/exported model.
function createToolCursor() {
  const group = new THREE.Group(); group.name = 'Viewport tool cursor'; group.visible = false;
  const material = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const marker = new THREE.Mesh(new THREE.RingGeometry(.62, 1, 32), material(0x7df4df));
  const center = new THREE.Mesh(new THREE.CircleGeometry(.18, 16), material(0xffffff)); marker.add(center);
  const brush = new THREE.Group(), ring = new THREE.Mesh(new THREE.RingGeometry(.98, 1, 96), material(0x7df4df));
  const diskMaterial = material(0x7df4df); diskMaterial.opacity = .075;
  const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 64), diskMaterial);
  brush.add(disk, ring); group.add(marker, brush);
  group.traverse(node => { node.renderOrder = 10000; node.frustumCulled = false; node.raycast = () => {}; });
  return { group, marker, brush, ring };
}

export class ModelViewer {
  constructor(host, onError = () => {}, onContextState = () => {}) {
    this.host = host; this.onError = onError; this.onContextState = onContextState;
    this.serial = 0; this.object = null; this.wire = false; this.surface = 'original'; this.shading = 'smooth'; this.destroyed = false;
    this.contextIsLost = false; this.sculptHandler = null; this.toolHandler = null; this.stroke = null;
    this.toolOptions = { mode: 'select', snap: 'surface', brushRadius: .1 }; this.legacySculpt = false; this.lastPointer = null;
    this.navigationEnabled = false; this.navigationSuspended = false; this.keys = new Set(); this.navigationFrame = null; this.navigationTime = 0;
    this.navigationModifiers = { shift: false, control: false };
    this.cameraLocked = false;
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(36, 1, .01, 100);
    this.perspectiveCamera = this.camera; this.orthographicCamera = null;
    this.scene.add(new THREE.HemisphereLight(0xe6f5ff, 0x26364d, 2.8));
    const key = new THREE.DirectionalLight(0xffffff, 3.5); key.position.set(4, 6, 4); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ab2ff, 2.1); rim.position.set(-4, 3, -3); this.scene.add(rim);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.toolCursor = createToolCursor(); this.scene.add(this.toolCursor.group);
    this.grid = new THREE.GridHelper(12, 24, 0x3e526c, 0x263344); this.grid.position.y = -1.7; this.grid.material.transparent = true; this.grid.material.opacity = .5; this.scene.add(this.grid);
    this.contextLost = event => {
      event.preventDefault();
      if (this.destroyed || event.target !== this.renderer.domElement) return;
      this.contextIsLost = true; this.stopNavigation(); this.hideCursor(); this.endStroke(event, true);
      this.onContextState('lost');
      this.onError('The graphics context was lost. Your mesh and unsaved edits are retained. Waiting for recovery; use Restore preview if it does not return.');
    };
    this.contextRestored = event => {
      if (this.destroyed || event.target !== this.renderer.domElement) return;
      this.contextIsLost = false;
      // Reduce pixel workload after a GPU reset. Three.js rebuilds its caches;
      // dirty CPU resources also cover edited geometry and image maps.
      this.renderer.setPixelRatio(1);this.studio?.dispose();this.studio=studioEnvironment(this.renderer);this.scene.environment=this.studio.texture; this.refreshGpuResources(); this.resize();
      this.onContextState('restored');
    };
    this.pointerDown = event => this.beginStroke(event);
    this.pointerMove = event => this.updateStroke(event);
    this.pointerUp = event => this.endStroke(event, event.type !== 'pointerup');
    this.pointerLeave = event => { if (!this.stroke) { this.lastPointer = null; this.hideCursor(); this.sendTool('hover', null, event); } };
    this.keyDown = event => this.handleNavigationKey(event, true);
    this.keyUp = event => this.handleNavigationKey(event, false);
    // Leave Ctrl/Cmd+wheel to the browser/WebView, before OrbitControls can
    // preventDefault or interpret the gesture as a much faster camera dolly.
    this.pageZoomWheel = event => {if(event.ctrlKey||event.metaKey)event.stopImmediatePropagation();};
    this.focusLost = () => { this.stopNavigation(); this.endStroke(null, true); this.lastPointer = null; this.hideCursor(); };
    this.visibilityChanged = () => { if (document.hidden) this.focusLost(); };
    globalThis.addEventListener('blur', this.focusLost); document.addEventListener('visibilitychange', this.visibilityChanged);
    this.createRenderer(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.reset(); this.resize();
  }
  createRenderer(pixelRatio) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(pixelRatio); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2; renderer.setClearColor(0x111720, 0);
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-label', '3D workspace. Click to focus. Drag to orbit, right-drag to pan, scroll to zoom. Active tools use left click; Alt-drag or middle-drag to orbit. WASD move, Q/E turn, R/F up/down, arrows look, Home frame.');
    canvas.setAttribute('role', 'img'); canvas.tabIndex = 0;
    canvas.addEventListener('wheel',this.pageZoomWheel,{capture:true,passive:true});
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
    // Capture listeners run before OrbitControls' bubbling pointer listeners.
    canvas.addEventListener('pointerdown', this.pointerDown, true);
    canvas.addEventListener('pointermove', this.pointerMove, true);
    canvas.addEventListener('pointerleave', this.pointerLeave, true);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, this.pointerUp, true);
    canvas.addEventListener('keydown', this.keyDown); canvas.addEventListener('keyup', this.keyUp); canvas.addEventListener('blur', this.focusLost);
    this.renderer = renderer; this.host.append(canvas);this.studio=studioEnvironment(renderer);this.scene.environment=this.studio.texture;
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = false; this.controls.minDistance = .4; this.controls.maxDistance = 20;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    this.controls.enabled = !this.cameraLocked;
    this.controls.addEventListener('change', () => { if (this.lastPointer && !this.stroke) this.updateHover(this.lastPointer); this.draw(); });
  }
  detachRenderer() {
    const renderer = this.renderer, canvas = renderer.domElement;
    canvas.removeEventListener('wheel',this.pageZoomWheel,true);
    canvas.removeEventListener('webglcontextlost', this.contextLost); canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    canvas.removeEventListener('pointerdown', this.pointerDown, true); canvas.removeEventListener('pointermove', this.pointerMove, true);
    canvas.removeEventListener('pointerleave', this.pointerLeave, true);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.removeEventListener(type, this.pointerUp, true);
    canvas.removeEventListener('keydown', this.keyDown); canvas.removeEventListener('keyup', this.keyUp); canvas.removeEventListener('blur', this.focusLost);
    this.controls.dispose();this.scene.environment=null;this.studio?.dispose();this.studio=null; renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  }
  refreshGpuResources() {
    const owned = resources(this.scene);
    for (const geometry of owned.geometries) {
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
      if (geometry.index) geometry.index.needsUpdate = true;
    }
    for (const material of owned.materials) material.needsUpdate = true;
    for (const texture of owned.textures) texture.needsUpdate = true;
  }
  recoverContext() {
    if (this.destroyed) return false;
    const target = this.controls.target.clone();
    this.stopNavigation(); this.hideCursor(); this.endStroke(null, true); this.contextIsLost = true; this.onContextState('recovering');
    try {
      this.detachRenderer(); this.createRenderer(1);
      this.controls.target.copy(target); this.controls.update(); this.refreshGpuResources();
      this.contextIsLost = false; this.resize(); this.onContextState('restored'); return true;
    } catch (error) {
      this.onContextState('lost'); this.onError(`The viewport could not recover: ${error.message}. Your mesh and unsaved edits are retained.`); return false;
    }
  }
  resize() {
    if (this.destroyed || this.contextIsLost) return;
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    if (this.camera.isOrthographicCamera) {
      const halfHeight = (this.camera.top - this.camera.bottom) / 2, center = (this.camera.left + this.camera.right) / 2;
      this.camera.left = center - halfHeight * this.camera.aspect; this.camera.right = center + halfHeight * this.camera.aspect;
    }
    this.camera.updateProjectionMatrix(); this.draw();
  }
  draw() { if (!this.destroyed && !this.contextIsLost) this.renderer.render(this.scene, this.camera); }
  reset(direction = 'orbit') {
    if (this.cameraLocked) return false;
    this.camera.position.set(...(direction === 'front' ? [0, .1, 7] : direction === 'top' ? [0, 7, .001] : direction === 'side' ? [7, .1, 0] : [4.7, 2.7, 5.3])); this.controls.target.set(0, 0, 0);
    if (this.camera.isOrthographicCamera) {
      const halfHeight = this.camera.position.length() * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2)) / this.perspectiveCamera.zoom;
      this.camera.top = halfHeight; this.camera.bottom = -halfHeight; this.camera.left = -halfHeight * this.camera.aspect; this.camera.right = halfHeight * this.camera.aspect; this.camera.zoom = 1; this.camera.updateProjectionMatrix();
    }
    this.controls.update(); this.draw(); return true;
  }
  setOrthographic(enabled) {
    const orthographic = Boolean(enabled);
    if (Boolean(this.camera.isOrthographicCamera) === orthographic) return true;
    if (this.cameraLocked || this.stroke || this.destroyed) return false;
    this.stopNavigation();
    const previous = this.camera, target = this.controls.target.clone(), aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    let next;
    if (orthographic) {
      const halfHeight = Math.max(.00001, previous.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(previous.fov / 2)) / previous.zoom);
      next = this.orthographicCamera ||= new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, previous.near, previous.far);
      next.left = -halfHeight * aspect; next.right = halfHeight * aspect; next.top = halfHeight; next.bottom = -halfHeight; next.zoom = 1;
      next.position.copy(previous.position);
    } else {
      next = this.perspectiveCamera;
      const halfHeight = (previous.top - previous.bottom) / (2 * previous.zoom);
      const distance = Math.max(.0001, halfHeight * next.zoom / Math.tan(THREE.MathUtils.degToRad(next.fov / 2)));
      const direction = previous.position.clone().sub(target).normalize();
      next.position.copy(target).addScaledVector(direction, distance);
      this.controls.minDistance = Math.min(this.controls.minDistance, distance * .5);
      this.controls.maxDistance = Math.max(this.controls.maxDistance, distance * 2);
    }
    next.quaternion.copy(previous.quaternion); next.up.copy(previous.up); next.aspect = aspect;
    next.near = Math.min(previous.near, Math.max(.00001, next.position.distanceTo(target) / 10000)); next.far = Math.max(previous.far, next.position.distanceTo(target) * 100);
    next.updateProjectionMatrix(); next.updateMatrixWorld(true); this.camera = next; this.controls.object = next;
    this.controls.target.copy(target); this.controls.update(); this.controls.saveState();
    if (this.lastPointer) this.updateHover(this.lastPointer); this.draw(); return true;
  }
  setWire(value) { this.wire = Boolean(value); this.applyAppearance(); }
  setSurface(value) { this.surface = value === 'clay' ? 'clay' : 'original'; this.applyAppearance(); }
  setShading(value) { this.shading = value === 'flat' ? 'flat' : 'smooth'; this.applyAppearance(); }
  applyAppearance() {
    this.object?.traverse(node => {
      if (!node.isMesh) return;
      let data = appearances.get(node);
      if (!data) {
        const missingNormals = !node.geometry.getAttribute('normal');
        if (missingNormals) node.geometry.computeVertexNormals();
        data = {
          original: node.material,
          display: Array.isArray(node.material) ? node.material.map(material => material.clone()) : node.material.clone(),
          missingNormals,
          clay: new THREE.MeshStandardMaterial({ color: 0xaeb8c4, roughness: .8, metalness: 0 })
        };
        appearances.set(node, data);
      }
      node.material = this.surface === 'clay' ? data.clay : data.display;
      materialList(node.material).forEach((material, index) => {
        const originalFlat = materialList(data.original)[index]?.flatShading;
        const flat = this.shading === 'flat' || (this.surface === 'original' && !data.missingNormals && originalFlat);
        if (material.flatShading !== Boolean(flat)) { material.flatShading = Boolean(flat); material.needsUpdate = true; }
        if ('wireframe' in material) material.wireframe = this.wire;
      });
    });
    this.draw();
  }
  setGrid(value) { this.grid.visible = Boolean(value); this.draw(); }
  getModelBounds() { return this.object ? modelBounds(this.object) : new THREE.Box3(); }
  canonicalMaterials(mesh) { return materialList(appearances.get(mesh)?.original || mesh?.material); }
  cloneEditableObject() {
    if (!this.object) return null;
    const clone = this.object.clone(true), sourceNodes = [], targetNodes = [];
    this.object.traverse(node => sourceNodes.push(node)); clone.traverse(node => targetNodes.push(node));
    const geometries = new Map(), materials = new Map(), textures = new Map();
    const cloneMaterial = material => {
      if (materials.has(material)) return materials.get(material);
      const copy = material.clone(); materials.set(material, copy);
      for (const [name, value] of Object.entries(material)) if (value?.isTexture) {
        if (!textures.has(value)) textures.set(value, value.clone());
        copy[name] = textures.get(value);
      }
      return copy;
    };
    sourceNodes.forEach((source, index) => {
      const target = targetNodes[index];
      if (source.geometry) {
        if (!geometries.has(source.geometry)) geometries.set(source.geometry, source.geometry.clone());
        target.geometry = geometries.get(source.geometry);
      }
      const original = appearances.get(source)?.original || source.material;
      if (original) target.material = Array.isArray(original) ? original.map(cloneMaterial) : cloneMaterial(original);
    });
    const nodeMap=new Map(sourceNodes.map((node,i)=>[node,targetNodes[i]]));
    sourceNodes.forEach((source,i)=>{if(source.isSkinnedMesh){const target=targetNodes[i];target.skeleton=source.skeleton.clone();target.skeleton.bones=source.skeleton.bones.map(b=>{check(nodeMap.has(b),'The complete skeleton must be in the imported scene.');return nodeMap.get(b);});target.bindMatrix.copy(source.bindMatrix);target.bindMatrixInverse.copy(source.bindMatrixInverse);}});
    clone.animations=(this.object.animations||[]).map(clip=>clip.clone());
    return clone;
  }
  setEditableObject(object, options = {}) { return this.replace(object, { frame: false, ...options }); }
  replace(object, { frame = true, disposeOld = true } = {}) {
    const bounds = modelBounds(object), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3()), largest = Math.max(size.x, size.y, size.z);
    check(Number.isFinite(largest) && largest > 1e-10 && largest < 1e12 && [center.x, center.y, center.z].every(Number.isFinite), 'The model has invalid or empty geometry.');
    ++this.serial;
    const old = this.object; this.root.clear(); this.object = object; this.root.add(object);
    if (frame || !old) {
      const scale = 3.2 / largest; this.root.scale.setScalar(scale); this.root.position.copy(center).multiplyScalar(-scale);
    }
    this.root.updateWorldMatrix(true, true);
    this.grid.position.y = bounds.min.y * this.root.scale.y + this.root.position.y - .012;
    if (disposeOld && old !== object) dispose(old, object);
    this.applyAppearance(); if (frame) this.reset();
    return { dimensions: [size.x, size.y, size.z] };
  }
  setToolHandler(handler, options = {}) {
    this.endStroke(null, true); this.toolHandler = typeof handler === 'function' ? handler : null;
    this.sculptHandler = null; this.legacySculpt = false;
    this.toolOptions = { mode: 'select', snap: 'surface', selectedObject: null, brushRadius: .1, ...options };
    if (this.renderer) this.renderer.domElement.style.cursor = this.toolHandler && this.toolOptions.mode !== 'select' ? 'crosshair' : '';
    this.hideCursor();
    if (this.lastPointer && this.toolHandler) this.updateHover(this.lastPointer);
  }
  setToolOptions(options = {}) {
    this.toolOptions = { ...this.toolOptions, ...options };
    if (this.lastPointer && this.toolHandler) this.updateHover(this.lastPointer);
  }
  setSculptHandler(handler) {
    this.setToolHandler(null); this.sculptHandler = typeof handler === 'function' ? handler : null;
    this.toolHandler = this.sculptHandler; this.legacySculpt = Boolean(this.sculptHandler);
    this.toolOptions.mode = 'sculpt';
  }
  hideCursor() { if (this.toolCursor.group.visible) { this.toolCursor.group.visible = false; this.draw(); } }
  showCursor(hit) {
    if (!hit || !this.toolHandler || this.contextIsLost) { this.hideCursor(); return; }
    const cursor = this.toolCursor, worldScale = this.root.getWorldScale(new THREE.Vector3());
    const cameraDepth = Math.abs(hit.worldPoint.clone().applyMatrix4(this.camera.matrixWorldInverse).z);
    const viewHeight = this.camera.isOrthographicCamera ? (this.camera.top - this.camera.bottom) / this.camera.zoom : 2 * cameraDepth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * .5)) / this.camera.zoom;
    const pixelSize = viewHeight / Math.max(1, this.renderer.domElement.clientHeight);
    cursor.group.visible = true; cursor.group.position.copy(hit.worldPoint);
    cursor.group.quaternion.setFromUnitVectors(UNIT_Z, hit.worldNormal);
    cursor.marker.scale.setScalar(Math.max(.00001, pixelSize * 6));
    cursor.marker.material.color.setHex(hit.snapKind === 'vertex' ? 0xffc47b : hit.snapKind === 'edge' ? 0x9ed5ff : 0x7df4df);
    cursor.brush.visible = this.toolOptions.mode === 'sculpt';
    const radius = Number(this.toolOptions.brushRadius);
    cursor.brush.scale.setScalar((Number.isFinite(radius) && radius > 0 ? radius : .1) * Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z)));
  }
  pick(event, options = this.toolOptions) {
    if (!this.object || this.contextIsLost) return null;
    const rect = this.renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true); this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.object, true).find(item => selectable(item.object, options, this.object) &&
      !(this.renderer.clippingPlanes || []).some(plane => plane.distanceToPoint(item.point) < 0));
    if (!hit) return null;
    const normal = (hit.normal || hit.face?.normal || new THREE.Vector3(0, 1, 0)).clone().normalize();
    let worldPoint = hit.point.clone(), snapKind = 'surface', vertexIndex = null, edgeIndices = null;
    if ((options.snap === 'vertex' || options.snap === 'edge') && hit.face) {
      const position = hit.object.geometry.getAttribute('position'), ids = [hit.face.a, hit.face.b, hit.face.c];
      const vertices = ids.map(index => new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(hit.object.matrixWorld));
      const clip = vertices.map(point => new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(this.camera.matrixWorldInverse).applyMatrix4(this.camera.projectionMatrix));
      const screen = clip.map(p => new THREE.Vector2(rect.left + (p.x / p.w + 1) * rect.width / 2, rect.top + (1 - p.y / p.w) * rect.height / 2));
      const mouse = new THREE.Vector2(event.clientX, event.clientY); let best = 12 * 12;
      if (options.snap === 'vertex') {
        screen.forEach((point, index) => {
          const distance = point.distanceToSquared(mouse);
          if (clip[index].w > 0 && distance <= best) { best = distance; worldPoint = vertices[index].clone(); snapKind = 'vertex'; vertexIndex = ids[index]; }
        });
      } else {
        for (let i = 0; i < 3; i++) {
          const j = (i + 1) % 3; if (clip[i].w <= 0 || clip[j].w <= 0) continue;
          const edge = screen[j].clone().sub(screen[i]), length = edge.lengthSq();
          const t = length ? THREE.MathUtils.clamp(mouse.clone().sub(screen[i]).dot(edge) / length, 0, 1) : 0;
          const nearest = screen[i].clone().addScaledVector(edge, t), distance = nearest.distanceToSquared(mouse);
          if (distance <= best) {
            // Perspective-correct interpolation keeps the marker on the actual 3D edge.
            const weight = (t / clip[j].w) / ((1 - t) / clip[i].w + t / clip[j].w);
            best = distance; worldPoint = vertices[i].clone().lerp(vertices[j], weight); snapKind = 'edge'; edgeIndices = [ids[i], ids[j]];
          }
        }
      }
    }
    const point = hit.object.worldToLocal(worldPoint.clone()), modelPoint = this.root.worldToLocal(worldPoint.clone());
    return { object: hit.object, point, normal, worldPoint, modelPoint,
      worldNormal: normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize(),
      faceIndex: hit.faceIndex, uv: hit.uv?.clone(), distance: worldPoint.distanceTo(this.camera.position), snapKind, vertexIndex, edgeIndices };
  }
  updateHover(event) {
    const hit = this.toolHandler && !event.altKey ? this.pick(event) : null;
    this.showCursor(hit); this.sendTool('hover', hit, event); return hit;
  }
  beginStroke(event) {
    // Focusing the canvas must not scroll the workbench while starting a gesture.
    this.renderer.domElement.focus({ preventScroll: true });
    this.lastPointer = event;
    if (!this.toolHandler || this.stroke || event.button !== 0 || event.altKey || (this.legacySculpt && !event.shiftKey) || this.contextIsLost || this.navigationSuspended) return;
    const hit = this.pick(event); this.showCursor(hit);
    if (!hit && this.toolOptions.mode !== 'select') return;
    event.preventDefault(); event.stopImmediatePropagation(); this.stopNavigation();
    this.stroke = { pointerId: event.pointerId, hit, controlsEnabled: this.controls.enabled }; this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture?.(event.pointerId);
    this.sendTool('begin', hit, event);
  }
  updateStroke(event) {
    this.lastPointer = event;
    if (this.navigationSuspended) { this.hideCursor(); return; }
    const hit = this.updateHover(event);
    if (!this.stroke || event.pointerId !== this.stroke.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!hit) return;
    this.stroke.hit = hit; this.sendTool('update', hit, event);
  }
  endStroke(event, cancelled = false) {
    if (!this.stroke || (event && 'pointerId' in event && event.pointerId !== this.stroke.pointerId)) return;
    const stroke = this.stroke; this.stroke = null; if (this.controls) this.controls.enabled = this.cameraLocked ? false : stroke.controlsEnabled;
    if (event?.type?.startsWith('pointer')) { event.preventDefault(); event.stopImmediatePropagation(); }
    const canvas = this.renderer?.domElement;
    if (canvas?.hasPointerCapture?.(stroke.pointerId)) canvas.releasePointerCapture(stroke.pointerId);
    this.sendTool('end', stroke.hit, event, cancelled);
  }
  sendTool(phase, hit, event, cancelled = false) {
    if (this.legacySculpt && phase === 'hover') return;
    if (phase === 'hover' && this.emittingHover) return;
    const previousHover = this.emittingHover; if (phase === 'hover') this.emittingHover = true;
    try { this.toolHandler?.({ phase, hit, event, cancelled }); this.draw(); }
    catch (error) { this.onError(error.message); if (phase !== 'end' && phase !== 'hover') this.endStroke(null, true); }
    finally { this.emittingHover = previousHover; }
  }
  sendSculpt(...args) { this.sendTool(...args); }
  setNavigationEnabled(enabled) { this.navigationEnabled = Boolean(enabled); if (!this.navigationEnabled) this.stopNavigation(); }
  setCameraLocked(locked) {
    const next = Boolean(locked); if (next === this.cameraLocked) return;
    this.cameraLocked = next;
    if (next) { this.cameraLockControlsEnabled = this.stroke?.controlsEnabled ?? this.controls?.enabled ?? true; this.stopNavigation(); }
    if (this.controls) this.controls.enabled = next ? false : this.cameraLockControlsEnabled !== false;
  }
  setNavigationSuspended(suspended) {
    this.navigationSuspended = Boolean(suspended);
    if (this.navigationSuspended) { this.stopNavigation(); this.hideCursor(); this.endStroke(null, true); }
  }
  navigationAllowed() {
    const canvas = this.renderer?.domElement;
    return this.navigationEnabled && !this.navigationSuspended && !this.cameraLocked && !this.contextIsLost && !this.destroyed && !this.stroke &&
      document.activeElement === canvas && canvas.getClientRects().length > 0 && !isEditable(document.activeElement) && !activeModal();
  }
  handleNavigationKey(event, pressed) {
    this.navigationModifiers.shift = Boolean(event.shiftKey); this.navigationModifiers.control = Boolean(event.ctrlKey);
    if (!pressed) {
      this.keys.delete(event.code);
      if (![...this.keys].some(key => NAV_KEYS.has(key))) this.stopNavigation();
      return;
    }
    if (!this.navigationAllowed() || event.metaKey || event.altKey) return;
    // Leave conventional application shortcuts such as Ctrl+S and Ctrl+Z intact.
    // Control still slows an already-held movement key.
    if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight' && !this.keys.has(event.code)) return;
    if (event.code === 'Home') { event.preventDefault(); this.focusObject(this.toolOptions.selectedObject || this.object); return; }
    if (!NAV_KEYS.has(event.code) && !['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation(); this.keys.add(event.code);
    if (this.navigationFrame === null && [...this.keys].some(key => NAV_KEYS.has(key))) {
      this.navigationTime = performance.now(); this.navigationFrame = requestAnimationFrame(time => this.navigate(time));
    }
  }
  stopNavigation() {
    this.keys.clear();
    this.navigationModifiers.shift = false; this.navigationModifiers.control = false;
    if (this.navigationFrame !== null) cancelAnimationFrame(this.navigationFrame);
    this.navigationFrame = null; this.navigationTime = 0;
  }
  navigate(time) {
    this.navigationFrame = null;
    if (!this.navigationAllowed() || ![...this.keys].some(key => NAV_KEYS.has(key))) { this.stopNavigation(); return; }
    const elapsed = Math.min(.05, Math.max(0, (time - this.navigationTime) / 1000)); this.navigationTime = time;
    const has = (...keys) => keys.some(key => this.keys.has(key));
    const factor = (this.navigationModifiers.shift ? 3 : 1) * (this.navigationModifiers.control ? .25 : 1);
    const distance = Math.max(.1, this.camera.position.distanceTo(this.controls.target));
    const direction = this.controls.target.clone().sub(this.camera.position).normalize();
    const yaw = (Number(has('KeyQ', 'ArrowLeft')) - Number(has('KeyE', 'ArrowRight'))) * elapsed * 1.25;
    direction.applyAxisAngle(WORLD_UP, yaw);
    const right = direction.clone().cross(WORLD_UP).normalize();
    const pitch = (Number(has('ArrowUp')) - Number(has('ArrowDown'))) * elapsed;
    const tilted = direction.clone().applyAxisAngle(right, pitch);
    if (Math.abs(tilted.dot(WORLD_UP)) < .995) direction.copy(tilted);
    const movement = direction.clone().multiplyScalar(Number(has('KeyW')) - Number(has('KeyS')))
      .addScaledVector(right, Number(has('KeyD')) - Number(has('KeyA')))
      .addScaledVector(WORLD_UP, Number(has('KeyR')) - Number(has('KeyF')));
    if (movement.lengthSq()) movement.normalize().multiplyScalar(elapsed * THREE.MathUtils.clamp(distance * .65, .2, 20) * factor);
    this.camera.position.add(movement); this.controls.target.copy(this.camera.position).addScaledVector(direction, distance);
    this.controls.update(); this.draw();
    this.navigationFrame = requestAnimationFrame(next => this.navigate(next));
  }
  focusObject(object = this.object) {
    if (!object || this.cameraLocked) return false;
    object.updateWorldMatrix(true, true); const bounds = new THREE.Box3();
    object.traverse(node => {
      if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
      for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return;
      node.geometry.computeBoundingBox(); bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
    });
    if (bounds.isEmpty()) return false;
    const center = bounds.getCenter(new THREE.Vector3()), radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const vfov = THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2), hfov = Math.atan(Math.tan(vfov) * this.camera.aspect);
    const distance = Math.max(.05, radius / Math.sin(Math.min(vfov, hfov)) * 1.1);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!direction.lengthSq()) direction.set(1, .5, 1).normalize();
    this.stopNavigation(); this.camera.position.copy(center).addScaledVector(direction, distance); this.controls.target.copy(center);
    if (this.camera.isOrthographicCamera) {
      const halfHeight = Math.max(.00001, radius * 1.1 / Math.min(1, this.camera.aspect));
      this.camera.top = halfHeight; this.camera.bottom = -halfHeight; this.camera.left = -halfHeight * this.camera.aspect; this.camera.right = halfHeight * this.camera.aspect; this.camera.zoom = 1;
    }
    this.controls.minDistance = Math.max(.001, distance / 1000); this.controls.maxDistance = Math.max(20, distance * 10);
    this.camera.near = Math.max(.0001, distance / 10000); this.camera.far = Math.max(100, distance * 100); this.camera.updateProjectionMatrix();
    this.controls.update(); this.draw(); return true;
  }
  getViewBasis() {
    this.root.updateWorldMatrix(true, false); this.camera.updateWorldMatrix(true, false);
    const inverse = this.root.matrixWorld.clone().invert();
    return {
      origin: this.root.worldToLocal(this.controls.target.clone()),
      u: new THREE.Vector3(1, 0, 0).transformDirection(this.camera.matrixWorld).transformDirection(inverse),
      v: new THREE.Vector3(0, 1, 0).transformDirection(this.camera.matrixWorld).transformDirection(inverse),
      normal: new THREE.Vector3(0, 0, 1).transformDirection(this.camera.matrixWorld).transformDirection(inverse)
    };
  }
  cancelPendingLoad() { ++this.serial; }
  async show(bytes) {
    const inspected = inspectGlb(bytes), token = ++this.serial;
    const manager = new THREE.LoadingManager();
    // GLTFLoader creates blob URLs for admitted embedded raster bufferViews only.
    manager.setURLModifier(url => { check(url.startsWith('blob:'), 'External model resources are disabled.'); return url; });
    const failedResources=[];manager.onError=url=>failedResources.push(url);
    const loader = new GLTFLoader(manager);
    const buffer = inspected.bytes.buffer.slice(inspected.bytes.byteOffset, inspected.bytes.byteOffset + inspected.bytes.byteLength);
    const gltf = await loader.parseAsync(buffer, '');
    if(failedResources.length){dispose(gltf.scene);throw Error('An embedded texture could not be loaded. The current model was kept. Rebuild/repackage with the updated cApp texture policy.');}
    if (token !== this.serial || this.destroyed) { dispose(gltf.scene); return null; }
    // glTF preserves custom extras, but has no visibility flag. Restore Builder's
    // saved visibility before previewing; a hidden parent still hides its children.
    gltf.scene.animations=gltf.animations;
    gltf.scene.traverse(node => { if (node.isMesh && node.userData.builderHidden) node.visible = false; });
    try { return { ...inspected, ...this.replace(gltf.scene) }; } catch (error) { dispose(gltf.scene); throw error; }
  }
  sample() {
    ++this.serial;
    const mesh = buildShapeGeometry(createDefaultShapeRecipe('hull')), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals.flat(), 3));
    geometry.setIndex(mesh.faces.flatMap(face => face.vertices));
    const material = new THREE.MeshStandardMaterial({ color: 0xb7c8ff, roughness: .36, metalness: .24 }); this.replace(new THREE.Mesh(geometry, material));
  }
  async thumbnail() {
    check(!this.contextIsLost, 'Recover the viewport before capturing a thumbnail. Your mesh is retained.');
    this.draw(); const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 240;
    const context = canvas.getContext('2d'); context.fillStyle = '#151e2b'; context.fillRect(0, 0, 360, 240);
    const src = this.renderer.domElement, scale = Math.min(360 / src.width, 240 / src.height), w = src.width * scale, h = src.height * scale;
    context.drawImage(src, (360 - w) / 2, (240 - h) / 2, w, h);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }
  destroy() {
    this.stopNavigation(); this.endStroke(null, true); this.destroyed = true; ++this.serial; this.resizeObserver.disconnect();
    globalThis.removeEventListener('blur', this.focusLost); document.removeEventListener('visibilitychange', this.visibilityChanged);
    dispose(this.object); dispose(this.grid); dispose(this.toolCursor.group); this.detachRenderer();
  }
}
