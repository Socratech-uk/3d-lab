import {initViewportCapture} from './viewport-capture.mjs';
const SVG = paths => `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  fullscreen: SVG('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>'),
  restore: SVG('<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/>'),
  select: SVG('<path d="m5 3 13 10-6 1-3 7Z"/>'),
  move: SVG('<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>'),
  rotate: SVG('<path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6"/>'),
  scale: SVG('<path d="M4 15v5h5M4 20 20 4m-7 0h7v7"/><path d="M4 11V4h7"/>'),
  cut: SVG('<path d="m5 6 13-2 2 14-14 2Z"/><circle cx="5" cy="6" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="20" cy="18" r="2"/><circle cx="6" cy="20" r="2"/>'),
  sculpt: SVG('<path d="m14 4 5 5M8 15 19 4l2 2-11 11"/><path d="M9 15c-5-2-6 4-6 6 2-2 8 0 7-5"/>'),
  undo: SVG('<path d="M9 4 3 10l6 6M3 10h11a7 7 0 0 1 7 7v3"/>'),
  redo: SVG('<path d="m15 4 6 6-6 6m6-6H10a7 7 0 0 0-7 7v3"/>')
};
const tools = [['select','Select','1'],['translate','Move','2'],['rotate','Rotate','3'],['scale','Scale','4'],['cut','Outline cut','5'],['sculpt','Sculpt','6']];
const helpRows = [
  ['1 / 2 / 3 / 4','Select / move / rotate / scale'], ['5 / 6','Outline cut / sculpt brush'],
  ['W A S D','Move forward / left / back / right'], ['Q / E','Turn left / right'], ['R / F','Move up / down'],
  ['↑ ↓ ← →','Look up / down / left / right'], ['Shift','Move faster'], ['Control','Slow down while moving'],
  ['Home','Frame the selected object'], ['[ / ]','Smaller / larger sculpt brush'], ['Enter','Finish the outline'],
  ['Backspace','Remove the last outline point'], ['Escape','Cancel the current outline'],
  ['Ctrl + S','Save an edited draft'], ['Ctrl + D','Duplicate selection'], ['Ctrl + Z / Y','Undo / redo'],
  ['Delete','Delete the selected object'], ['H / Shift + H','Hide selection / show all'],
  ['Alt + drag','Orbit temporarily while a tool is active'], ['Middle drag','Orbit the camera'],
  ['Right drag / wheel','Pan / zoom'], ['?','Open this keyboard guide']
];
const shapeHelpRows = [
  ['1 / 2 / 3','Select / draw outline / insert point'], ['Click / drag','Select a point / move the selected point'],
  ['Shift / Alt + arrows','Larger / finer sketch nudges'], ['Space + drag / middle / right drag','Pan the sketch'],
  ['Wheel / + / −','Zoom the sketch'], ['↑ ↓ ← →','Nudge selected sketch points'], ['Alt + drag','Temporarily bypass sketch snapping'],
  ['Enter','Finish the drawn outline'], ['Escape','Cancel the current sketch gesture'],
  ['Delete / Backspace','Remove the selected sketch point'], ['Home','Fit the focused sketch or 3D view'],
  ['Ctrl + S','Save a shape draft'], ['Ctrl + D','Duplicate the selected shape'],
  ['Ctrl + Z / Y','Undo / redo'], ['W A S D','Move the focused 3D camera'],
  ['Q / E','Turn the 3D camera left / right'], ['R / F','Move the 3D camera up / down'],
  ['Shift / Control','Faster / slower 3D movement'], ['3D drag / right drag','Orbit / pan the 3D view'],
  ['?','Open this keyboard guide']
];
const actionHelpRows=[['1 / 2 / 3 / 4 / 5 / 6','Select / joints / move / rotate / IK / weights'],['Space','Play or pause the action'],['K / Shift + K','Key all joints / selected joint'],['Ctrl + S','Save an action draft'],['Ctrl + Z / Y','Undo / redo'],['Delete','Remove selected joint after confirmation'],['Escape','Cancel gesture or hinge axis'],['[ / ]','Smaller / larger weight brush'],['W A S D','Move the camera'],['Q / E','Turn left / right'],['R / F','Move up / down'],['Shift / Control','Faster / slower camera movement'],['Home','Frame the model'],['Alt + drag / middle drag','Orbit while a tool is active'],['Right drag / wheel','Pan / zoom'],['?','Open this guide']];
const editableTarget = target => Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'));

export function initViewportWorkspace({ viewer, getBuilder, getShape = () => null, getAction = () => null }) {
  const stage = document.querySelector('.stage-panel'), top = stage?.querySelector('.stage-top');
  const builderView = document.getElementById('builder-view'), toolsPanel = document.getElementById('builder-tools'), objectsPanel = document.getElementById('builder-inspector');
  const shapeView = document.getElementById('shape-view'), shapeTools = document.getElementById('shape-tools'), shapeObjects = document.getElementById('shape-inspector');
  const actionView=document.getElementById('action-view'),actionTools=document.getElementById('action-tools'),actionObjects=document.getElementById('action-inspector');
  if (!stage || !top) return { refresh() {}, destroy() {} };
  const hint = stage.querySelector('.stage-bottom>span:first-child'), originalHint = hint?.textContent || '';
  let expandedTarget = null, fallback = false, pending = false, previousFocus = null, disposed = false, scheduled = null;
  const actions = document.createElement('div'); actions.className = 'viewport-workspace-actions';
  const button = (label, html, className = '') => {
    const node = document.createElement('button'); node.type = 'button'; node.className = className; node.title = label; node.setAttribute('aria-label', label); node.innerHTML = html; return node;
  };
  const toolsToggle = button('Toggle tool settings', 'Tools', 'viewport-panel-toggle'), objectsToggle = button('Toggle scene objects', 'Objects', 'viewport-panel-toggle');
  toolsToggle.setAttribute('aria-controls', 'builder-tools'); objectsToggle.setAttribute('aria-controls', 'builder-inspector');
  toolsToggle.setAttribute('aria-expanded', 'false'); objectsToggle.setAttribute('aria-expanded', 'false');
  const help = button('Keyboard and mouse guide (?)', '?', 'viewport-help-button'), fullscreen = button('Enter fullscreen workspace', icons.fullscreen, 'viewport-fullscreen-button');
  fullscreen.setAttribute('aria-pressed', 'false'); actions.append(toolsToggle, objectsToggle, help, fullscreen); top.append(actions);
  const png=button('Save viewport screenshot (PNG)',SVG('<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>'),'viewport-png-button'),gif=button('Create animated GIF','GIF','viewport-gif-button');
  actions.insertBefore(png,help);actions.insertBefore(gif,help);
  const capture=initViewportCapture({viewer,getBuilder,getShape,getAction,buttons:{png,gif}});
  const toolbar = document.createElement('div'); toolbar.className = 'viewport-workbench-toolbar'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Build tools');
  const toolButtons = tools.map(([tool, label, key]) => {
    const node = button(`${label} (${key})`, `${icons[tool === 'translate' ? 'move' : tool]}<span class="viewport-tool-label">${label}</span>`, 'viewport-tool-button');
    node.dataset.workspaceTool = tool; node.setAttribute('aria-pressed', 'false');
    node.addEventListener('click', async () => {
      const builder = getBuilder(); if (!builder?.active || builder.busy) return;
      await builder.run(() => builder.setTool(tool)); refresh(); viewer.renderer.domElement.focus({preventScroll:true});
    });
    toolbar.append(node); return node;
  });
  const separator = document.createElement('span'); separator.className = 'viewport-tool-divider'; separator.setAttribute('aria-hidden', 'true'); toolbar.append(separator);
  const undo = button('Undo (Ctrl+Z)', icons.undo), redo = button('Redo (Ctrl+Y)', icons.redo);
  undo.addEventListener('click', () => { const builder = getBuilder(); if (builder?.active && !builder.busy) builder.run(() => builder.undo(false)); });
  redo.addEventListener('click', () => { const builder = getBuilder(); if (builder?.active && !builder.busy) builder.run(() => builder.undo(true)); });
  toolbar.append(undo, redo); stage.append(toolbar);
  const status = document.createElement('span'); status.className = 'viewport-workspace-sr'; status.setAttribute('role', 'status'); stage.append(status);
  const dismiss = button('Close workspace side panel', '×', 'viewport-panel-dismiss'); dismiss.hidden = true; builderView?.append(dismiss);
  const shapeChrome = document.createElement('div'); shapeChrome.className = 'viewport-shape-chrome'; shapeChrome.hidden = true;
  const shapePanes = document.createElement('div'); shapePanes.className = 'viewport-shape-panes'; shapePanes.setAttribute('role','group'); shapePanes.setAttribute('aria-label','Shape workspace panes');
  const paneButtons = ['split','sketch','preview'].map(pane => {
    const label = pane === 'preview' ? '3D' : pane === 'sketch' ? 'Sketch' : 'Split';
    const node = button(`Show ${pane === 'preview' ? '3D preview' : pane === 'sketch' ? 'sketch' : 'sketch and 3D preview'}`, label);
    node.dataset.shapePane = pane; node.setAttribute('aria-pressed',String(pane === 'split'));
    node.addEventListener('click', () => {
      if (!inShape()) return;
      document.getElementById('shape-workspace').dataset.layout = pane === 'preview' ? '3d' : pane;
      for (const other of paneButtons) other.setAttribute('aria-pressed', String(other === node));
      for (const other of document.querySelectorAll('[data-shape-layout]')) { const selected = other.dataset.shapeLayout === (pane === 'preview' ? '3d' : pane); other.classList.toggle('selected',selected); other.setAttribute('aria-pressed',String(selected)); }
      if (pane === 'sketch') viewer.stopNavigation?.();
      resize();
    });
    shapePanes.append(node); return node;
  });
  shapeChrome.append(shapePanes); shapeView?.append(shapeChrome);
  const dialog = document.createElement('dialog'); dialog.className = 'viewport-keyboard-help'; dialog.setAttribute('aria-labelledby','viewport-keyboard-title');
  stage.append(dialog);
  const inBuilder = () => Boolean(builderView && !builderView.hidden && builderView.contains(stage) && getBuilder()?.active);
  const inAction = () => Boolean(actionView && !actionView.hidden && actionView.contains(stage) && getAction()?.active);
  const inShape = () => Boolean(shapeView && !shapeView.hidden && shapeView.contains(stage) && getShape()?.active);
  const resize = () => { if (!disposed) requestAnimationFrame(() => { if (!disposed) { viewer.resize(); shapeView?.dispatchEvent(new Event('shape-workspace-resize')); } }); };
  function closePanels() {
    for (const view of [builderView,shapeView,actionView]) view?.classList.remove('viewport-panel-tools','viewport-panel-objects');
    toolsToggle.setAttribute('aria-expanded','false'); objectsToggle.setAttribute('aria-expanded','false'); dismiss.hidden = true;
  }
  function togglePanel(kind) {
    const shapeActive = inShape(), view = inAction() ? actionView : shapeActive ? shapeView : inBuilder() ? builderView : null;
    if (!expandedTarget || !view) return;
    const wasOpen = view.classList.contains(`viewport-panel-${kind}`); closePanels();
    if (!wasOpen) {
      view.classList.add(`viewport-panel-${kind}`); (kind === 'tools' ? toolsToggle : objectsToggle).setAttribute('aria-expanded','true');
      view.append(dismiss);
      dismiss.hidden = false; dismiss.dataset.side = kind;
      const panel = kind === 'tools' ? (inAction() ? actionTools : shapeActive ? shapeTools : toolsPanel) : (inAction() ? actionObjects : shapeActive ? shapeObjects : objectsPanel);
      panel?.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)')?.focus({preventScroll:true});
    }
    resize();
  }
  toolsToggle.addEventListener('click', () => togglePanel('tools')); objectsToggle.addEventListener('click', () => togglePanel('objects'));
  dismiss.addEventListener('click', () => { const kind = dismiss.dataset.side; closePanels(); (kind === 'tools' ? toolsToggle : objectsToggle).focus(); });
  function cleanupFullscreen() {
    const old = expandedTarget; expandedTarget = null; fallback = false; closePanels();
    old?.classList.remove('viewport-expanded','viewport-expanded-fallback'); document.body.classList.remove('viewport-fullscreen-active');
    fullscreen.innerHTML = icons.fullscreen; fullscreen.setAttribute('aria-label','Enter fullscreen workspace'); fullscreen.title = 'Enter fullscreen workspace'; fullscreen.setAttribute('aria-pressed','false');
    status.textContent = 'Windowed workspace'; refresh(); resize();
    if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({preventScroll:true}); previousFocus = null;
  }
  async function exitFullscreen() {
    if (!expandedTarget) return;
    if (document.fullscreenElement === expandedTarget && document.exitFullscreen) { try { await document.exitFullscreen(); } catch {} }
    if (expandedTarget) cleanupFullscreen();
  }
  async function enterFullscreen() {
    if (pending || disposed || expandedTarget) return;
    pending = true; previousFocus = document.activeElement; expandedTarget = inAction() ? actionView : inShape() ? shapeView : inBuilder() ? builderView : stage;
    expandedTarget.classList.add('viewport-expanded'); document.body.classList.add('viewport-fullscreen-active');
    // The local desktop shell may not expose the Fullscreen API. The same layout
    // remains usable through a fixed workspace when that API is unavailable.
    try {
      if (!expandedTarget.requestFullscreen) throw new Error('Fullscreen API unavailable');
      await expandedTarget.requestFullscreen(); fallback = false;
    } catch { if (expandedTarget) { fallback = true; expandedTarget.classList.add('viewport-expanded-fallback'); } }
    finally { pending = false; }
    if (!expandedTarget || disposed) return;
    fullscreen.innerHTML = icons.restore; fullscreen.setAttribute('aria-label','Exit fullscreen workspace'); fullscreen.title = 'Exit fullscreen workspace'; fullscreen.setAttribute('aria-pressed','true');
    status.textContent = 'Fullscreen workspace. Tool settings and objects are available from the top right.'; refresh(); resize(); viewer.renderer.domElement.focus({preventScroll:true});
  }
  fullscreen.addEventListener('click', () => { if (!pending) expandedTarget ? exitFullscreen() : enterFullscreen(); });
  const fullChange = () => { if (expandedTarget && !fallback && document.fullscreenElement !== expandedTarget && !pending) cleanupFullscreen(); resize(); };
  document.addEventListener('fullscreenchange', fullChange);
  let helpFocus = null;
  const showHelp = () => {
    viewer.stopNavigation?.(); if (dialog.open) return;
    helpFocus = document.activeElement;
    const shape = inShape(), builder = inBuilder(), rows = inAction() ? actionHelpRows : shape ? shapeHelpRows : builder ? helpRows : helpRows.filter(([key]) => ['W A S D','Q / E','R / F','↑ ↓ ← →','Shift','Control','Home','Right drag / wheel','?'].includes(key));
    const heading = shape ? 'Shape in two dimensions. Inspect in three.' : 'Keep your hands on the model.';
    const intro = shape ? 'Click the sketch to edit points. Click the 3D preview to navigate the camera. Typing in fields never edits the sketch or moves the camera.' : `Click the 3D canvas to use movement keys. Typing in fields never moves the camera.${builder ? ' Outlining locks the view until you finish or cancel.' : ''}`;
    const note = inAction() ? 'Joints remain visible through the mesh. Joint placement and weight brushes track the surface. Pose changes add keys automatically. Fullscreen keeps the timeline and side panels available.' : shape ? 'Sketch points and segments show the current selection and snapping position. The 3D preview follows the shape settings. Fullscreen keeps sketch, preview, tools and objects available.' : builder ? 'Outline points and brush footprints follow the visible model surface. Alt-drag changes the view only when an outline is not in progress.' : 'Use the view buttons to frame and inspect your model.';
    (shape ? shapeView : stage).append(dialog);
    dialog.innerHTML = `<form method="dialog"><div class="viewport-help-heading"><div><span class="eyebrow">${shape ? 'SHAPE LAB' : 'WORKSPACE'} CONTROLS</span><h2 id="viewport-keyboard-title">${heading}</h2></div><button value="close" aria-label="Close keyboard guide" title="Close keyboard guide">×</button></div><p>${intro}</p><dl>${rows.map(([key,label])=>`<div><dt><kbd>${key}</kbd></dt><dd>${label}</dd></div>`).join('')}</dl><p class="helper">${note}</p><div class="dialog-actions"><button value="close" class="primary" title="Close keyboard guide and return to the model">Back to the model</button></div></form>`;
    dialog.showModal();
  };
  help.addEventListener('click', showHelp);
  dialog.addEventListener('close', () => {
    if (disposed) return;
    const focus = inShape() && helpFocus?.isConnected && helpFocus.getClientRects().length ? helpFocus : viewer.renderer?.domElement;
    focus?.focus({preventScroll:true}); helpFocus = null;
  });
  const keys = event => {
    if (event.defaultPrevented || editableTarget(event.target) || !(inShape() ? shapeView : stage).getClientRects().length) return;
    // Asset selection and save/discard prompts own their keyboard input, including
    // Escape; closing a modal must not also leave the fullscreen workspace.
    if ([...document.querySelectorAll('dialog[open]')].some(open => open !== dialog)) return;
    if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey && !dialog.open) { event.preventDefault(); showHelp(); }
    else if (event.key === 'Escape' && fallback && !dialog.open) {
      // Let Builder's window handler cancel a live outline before a subsequent
      // Escape closes the fallback fullscreen workspace.
      if ((inAction() && getAction()?.hasPending) || (inBuilder() && (getBuilder()?.hasPending || getBuilder()?.outline?.points?.length)) || (inShape() && getShape()?.hasPending)) return;
      event.preventDefault(); exitFullscreen();
    }
  };
  document.addEventListener('keydown', keys);
  function refresh() {
    if (disposed) return;
    const builder = getBuilder(), active = inBuilder(), shapeActive = inShape(), actionActive=inAction();
    stage.dataset.workspaceBuilder = String(active); stage.dataset.workspaceShape = String(shapeActive); toolbar.hidden = !active;
    const shapeExpanded = expandedTarget === shapeView && shapeActive;
    shapeChrome.hidden = !shapeExpanded;
    const actionsParent = shapeExpanded ? shapeChrome : top;
    if (actions.parentNode !== actionsParent) actionsParent.append(actions);
    const shapePane = document.getElementById('shape-workspace')?.dataset.layout || 'split';
    for (const node of paneButtons) node.setAttribute('aria-pressed', String((node.dataset.shapePane === 'preview' ? '3d' : node.dataset.shapePane) === shapePane));
    toolsToggle.setAttribute('aria-controls', actionActive ? 'action-tools' : shapeActive ? 'shape-tools' : 'builder-tools');
    objectsToggle.setAttribute('aria-controls', actionActive ? 'action-inspector' : shapeActive ? 'shape-inspector' : 'builder-inspector');
    if (hint) {
      const message = actionActive ? 'Click joints or parts · Alt-drag orbit · K key pose · Space play' : shapeActive ? 'Edit points in the sketch · Drag here to orbit · WASD move · Q/E turn' : !active ? originalHint : builder.tool === 'cut' ? (builder.outline?.points?.length ? 'View locked · Click points · Enter separates · Esc cancels' : 'Click a surface to begin · Alt-drag orbit · Orthographic cut view') : builder.tool === 'sculpt' ? 'Left-drag to sculpt · [ ] brush size · Alt-drag orbit' : builder.tool === 'select' ? 'Click to select · Ctrl-click to add · Alt-drag orbit · WASD move' : 'Drag transform handles · Alt-drag orbit · WASD move';
      if (hint.textContent !== message) hint.textContent = message; hint.title = message;
    }
    toolsToggle.hidden = objectsToggle.hidden = !(expandedTarget && (active || shapeActive || actionActive));
    if (expandedTarget && ((expandedTarget === actionView && !actionActive) || (expandedTarget === builderView && !active) || (expandedTarget === shapeView && !shapeActive))) { exitFullscreen(); return; }
    for (const node of toolButtons) { node.disabled = !active || Boolean(builder.busy); node.setAttribute('aria-pressed', String(builder?.tool === node.dataset.workspaceTool)); }
    undo.disabled = !active || Boolean(builder?.busy) || Boolean(builder?.hasPending) || !builder?.history?.length;
    redo.disabled = !active || Boolean(builder?.busy) || Boolean(builder?.hasPending) || !builder?.future?.length;
  }
  const scheduleRefresh = () => { if (scheduled === null) scheduled = requestAnimationFrame(() => { scheduled = null; refresh(); }); };
  document.addEventListener('builder-state-change', scheduleRefresh);
  document.addEventListener('shape-state-change', scheduleRefresh);
  document.addEventListener('action-state-change', scheduleRefresh);
  const observer = new MutationObserver(scheduleRefresh);
  if (builderView) observer.observe(builderView,{attributes:true,attributeFilter:['hidden']});
  if (actionView) observer.observe(actionView,{attributes:true,attributeFilter:['hidden']});
  if (shapeView) observer.observe(shapeView,{attributes:true,attributeFilter:['hidden']});
  for (const panel of [toolsPanel,objectsPanel,shapeTools,shapeObjects,actionTools,actionObjects]) if (panel) observer.observe(panel,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-pressed']});
  refresh();
  return {
    refresh, enterFullscreen, exitFullscreen, showHelp,
    get fullscreen() { return Boolean(expandedTarget); },
    destroy() {
      if (disposed) return;
      capture.destroy();
      if (expandedTarget) { if (document.fullscreenElement === expandedTarget) document.exitFullscreen?.().catch(() => {}); cleanupFullscreen(); }
      disposed = true; if (scheduled !== null) cancelAnimationFrame(scheduled); observer.disconnect(); document.removeEventListener('fullscreenchange',fullChange); document.removeEventListener('keydown',keys); document.removeEventListener('builder-state-change',scheduleRefresh); document.removeEventListener('shape-state-change',scheduleRefresh); document.removeEventListener('action-state-change',scheduleRefresh);
      actions.remove(); toolbar.remove(); status.remove(); dismiss.remove(); dialog.remove(); shapeChrome.remove(); delete stage.dataset.workspaceBuilder; delete stage.dataset.workspaceShape;
      if (hint) { hint.textContent = originalHint; hint.removeAttribute('title'); }
    }
  };
}
