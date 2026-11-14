/** Shape Lab workspace chrome. Geometry, pointer interaction and persistence live elsewhere. */
const button = (id, label, help, cls = '') => `<button type="button" id="${id}" class="${cls}" title="${help}">${label}</button>`;
const field = (id, label, value, {step = '.01', min, max} = {}) => `<label class="field">${label}<input id="${id}" type="number" value="${value}" step="${step}"${min === undefined ? '' : ` min="${min}"`}${max === undefined ? '' : ` max="${max}"`}></label>`;
const range = (id, label, value, min = 0, max = 1, step = '.01') => `<label class="field">${label}<input id="${id}" type="range" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
const pair = (...items) => `<div class="shape-pair">${items.join('')}</div>`;
const xyz = (prefix, label, values, step = '.01') => `<span class="shape-label">${label}</span><div class="shape-xyz">${['x','y','z'].map((axis,i) => field(`${prefix}-${axis}`,axis.toUpperCase(),values[i],{step})).join('')}</div>`;
const icon = (content) => `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const icons = {
  select:icon('<path d="m5 3 11 7-5 1-2 5-4-13Z"/>'),
  draw:icon('<path d="m4 15 1-4 9-9 4 4-9 9-5 1Z"/><path d="m12 4 4 4M5 11l4 4"/>'),
  insert:icon('<path d="M3 14 10 7l7 7M10 3v8M6 7h8"/><circle cx="3" cy="14" r="1.5"/><circle cx="17" cy="14" r="1.5"/>'),
  pan:icon('<path d="M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3M15 7l3 3-3 3"/>'),
};

export const shapeToolsMarkup = `<div class="eyebrow">04 / SHAPE</div>
<h1>Give it form.</h1><p class="helper shape-intro">Draw a profile, move its points and watch the volume take shape.</p>
<div class="shape-add-card"><label class="field">Build from<select id="s-kind"><option value="profile">Paired profiles · hulls &amp; wings</option><option value="extrude">Closed sketch · extrusion</option><option value="revolve">Radial sketch · revolution</option></select></label>
<label class="field">Starting shape<select id="s-preset"><option value="hull">Streamlined hull</option><option value="wing">Wing / blade</option><option value="fin">Swept fin</option><option value="canopy">Canopy</option><option value="panel">Panel</option><option value="stand">Stand / strut</option></select></label>
${button('s-add','+ Add shape','Add this shape as a separate object in the scene','primary')}
${button('s-replace-preset','Reset selected to preset','Replace the selected object’s profile or sketch with this preset; Undo is available','text-button')}</div>
<div class="shape-tabs" role="group" aria-label="Shape tools">${[['profile','Profile'],['sketch','Sketch'],['transform','Transform'],['formula','Formula']].map(([id,label],i) => `<button type="button" data-shape-tab="${id}" class="${i ? '' : 'selected'}" aria-pressed="${i ? 'false' : 'true'}" title="Open ${label.toLowerCase()} tools">${label}</button>`).join('')}</div>

<div data-shape-panel="profile"><h2>Pull the profile</h2><p class="helper">Drag a coloured point or the line between points. Side view edits height; Top view edits width. The 3D shape updates as you work.</p>
<div class="shape-profile-dimensions">${field('s-length','Length · X',4,{min:.02,max:1000})}${pair(field('s-height','Height · Y',1.4,{min:.02,max:1000}),field('s-depth','Width · Z',1.6,{min:.02,max:1000}))}</div>
${range('s-smoothness','Curve smoothness',.85)}${range('s-roundness','Cross-section roundness',.8)}
${pair(field('s-segments','Length divisions',48,{min:8,max:128,step:1}),field('s-radial','Ring divisions',24,{min:8,max:48,step:4}))}${button('s-apply-profile','Apply profile settings','Rebuild the profile with these dimensions and surface settings','primary')}
<h3>Linked points</h3><p class="helper">Linked pairs move together. Unlink a pair to pull either side independently, including along the length.</p>
${pair(button('s-link-pair','Link pair','Link the selected point to its opposite point'),button('s-unlink-pair','Unlink pair','Let the selected point and its opposite move independently'))}
${pair(button('s-link-all','Link all','Link all opposite height and width point pairs'),button('s-unlink-all','Unlink all','Allow every edge point to move independently'))}
${pair(button('s-add-station','+ Add station','Insert another editable pair between existing stations'),button('s-mirror-profile','Mirror this profile','Copy upper to lower and far to near, then link every point pair'))}
<h3>End shapes</h3><span class="shape-label">Start · left end</span>${pair(button('s-end-start-point','Pointed','Bring the start height and width to a point'),button('s-end-start-flat','Flat','Open the start to a flat capped end'))}
<span class="shape-label">Finish · right end</span>${pair(button('s-end-end-point','Pointed','Bring the finish height and width to a point'),button('s-end-end-flat','Flat','Open the finish to a flat capped end'))}
</div>

<div data-shape-panel="sketch" hidden><h2>Draw the silhouette</h2><p class="helper">Choose an extrusion or revolution above. Click to place connected points, then close the outline on its first point or press Enter.</p>
${button('s-draw','Draw a new outline','Replace the selected sketch by drawing a new closed outline','primary')}${pair(button('s-finish-draw','Close outline','Complete the outline with at least three points · Enter'),button('s-cancel-draw','Cancel drawing','Discard the unfinished outline · Escape'))}
${pair(button('s-insert-point','Insert a point','Click an outline edge to insert a new point'),button('s-subdivide','Subdivide edges','Add a midpoint to every sketch edge'))}${button('s-reverse-points','Reverse point order','Reverse the direction of the closed sketch without changing its outline')}
<h3>Extrusion</h3>${field('s-extrude-depth','Depth · model units',1,{min:.01,max:1000})}${pair(field('s-bevel','Bevel width',0,{min:0,max:100}),field('s-taper','End scale',1,{min:.05,max:20}))}
${pair(field('s-twist','Twist · degrees',0,{min:-720,max:720,step:1}),field('s-extrude-steps','Depth divisions',8,{min:1,max:128,step:1}))}
<p class="helper">Use more depth divisions for a smooth twist. Bevels must fit inside the shape and its depth.</p>
<h3>Revolution</h3>${field('s-revolve-segments','Around-axis divisions',32,{min:8,max:128,step:1})}<p class="helper">The vertical line is the turning axis. Draw to its right: X is radius, Y is height.</p>
${button('s-apply-sketch','Apply solid settings','Rebuild the selected extrusion or revolution from these settings','primary')}</div>

<div data-shape-panel="transform" hidden><h2>Arrange the scene</h2><p class="helper">Position each shape independently. These values stay editable in the saved recipe.</p>
${xyz('s-position','Position · model units',[0,0,0])}${xyz('s-rotation','Rotation · degrees',[0,0,0],1)}${xyz('s-scale','Scale factors',[1,1,1])}
${button('s-apply-transform','Apply transform','Set the selected object’s position, rotation and scale','primary')}
<span class="shape-label">Mirror selected object</span>${pair(...['x','y','z'].map(a => button('s-mirror-'+a,a.toUpperCase(),'Mirror the selected object along its '+a.toUpperCase()+' axis')))}
${button('s-reset-transform','Reset transform','Reset position and rotation to zero, and scale to one')}
<p class="helper">The sketch shows the object’s own coordinates; its transform places it in the 3D scene. Use Builder for sculpting, cuts and mesh-level edits.</p></div>

<div data-shape-panel="formula" hidden><h2>A curve from a formula</h2><p class="helper">Shape an edge with a function, then refine its visible points by hand.</p>
<label class="field">Example curve<select id="s-formula-preset"><option value="sin(pi*t)">Smooth arch · sin(pi*t)</option><option value="sqrt(max(0,1-(2*t-1)^2))">Ellipse · rounded profile</option><option value="4*t*(1-t)">Parabola · broad arch</option><option value="1-t">Straight taper · 1-t</option><option value="0.35+0.65*abs(cos(pi*t))">Waisted support</option><option value="0.7+0.2*sin(4*pi*t)">Ripple · soft repeating curve</option></select></label>
<label class="field">Curve expression<input id="s-formula" type="text" value="sin(pi*t)" maxlength="256" spellcheck="false" autocomplete="off" autocapitalize="off"></label>
<label class="field">Apply to<select id="s-formula-channel"><option value="upper">Upper edge</option><option value="lower">Lower edge</option><option value="depth">Both width edges</option><option value="symmetric">Upper &amp; lower edges</option></select></label>
${field('s-formula-count','Editable stations',9,{min:3,max:33,step:1})}${button('s-apply-formula','Apply curve','Sample the curve into editable profile points; Undo is available','primary')}
<div class="shape-formula-guide"><span class="shape-label">Formula guide</span><p><code>t</code> runs from <b>0</b> at the start to <b>1</b> at the finish. The result controls edge reach; keep it between <b>0</b> and <b>4</b>.</p><p>Use <code>sin</code>, <code>cos</code>, <code>abs</code>, <code>sqrt</code>, <code>pow</code>, <code>min</code>, <code>max</code> or <code>clamp</code>, with <code>pi</code> and arithmetic.</p></div></div>

<details class="shape-point-editor" open><summary>Selected point</summary><p id="s-point-label" class="helper">Select a point on the canvas for exact coordinates.</p>${pair(field('s-point-x','X · model units',0),field('s-point-y','Y · model units',0))}
${button('s-apply-point','Set point position','Move the selected point to these exact local coordinates')}${button('s-remove-point','Remove selected point','Remove the selected sketch point or interior profile station; Undo is available','text-button danger')}</details>`;

export const shapeWorkspaceMarkup = `<div class="shape-workspace-head"><div><span class="eyebrow">LIVE WORKSPACE</span><strong>Outline to object</strong></div><div class="shape-layout-switch" role="group" aria-label="Workspace layout"><button type="button" data-shape-layout="split" class="selected" aria-pressed="true" title="Show the sketch and 3D preview together">Split</button><button type="button" data-shape-layout="sketch" aria-pressed="false" title="Give the sketch the full workspace">Sketch</button><button type="button" data-shape-layout="3d" aria-pressed="false" title="Give the 3D preview the full workspace">3D</button></div></div>
<div class="shape-pane-grid"><section class="shape-sketch-pane shape-sketch-panel" aria-label="Editable shape sketch"><div class="shape-sketch-heading"><span class="shape-pane-label"><i></i>2D SKETCH</span><div class="shape-view-switch" role="group" aria-label="Profile view">${button('s-view-side','Side · XY','Edit the upper and lower profile in the side view','selected')}${button('s-view-top','Top · XZ','Edit the near and far width profiles in the top view')}</div></div>
<div class="shape-sketch-toolbar" role="group" aria-label="Sketch tools">${button('s-tool-select',icons.select+'<span>Select</span>','Select and drag visible points or edges','selected')}${button('s-tool-draw',icons.draw+'<span>Draw</span>','Draw a connected outline for an extrusion or revolution')}${button('s-tool-insert',icons.insert+'<span>Insert</span>','Insert a point on an edge or a profile station')}${button('s-tool-pan',icons.pan+'<span>Pan</span>','Drag to move the sketch view')}<span class="shape-toolbar-divider" aria-hidden="true"></span>${button('s-fit','Fit','Fit the entire selected outline into the sketch view')}${button('s-zoom-out','−','Zoom out of the sketch')}${button('s-zoom-in','+','Zoom into the sketch')}</div>
<div class="shape-canvas-wrap"><canvas id="s-canvas" tabindex="0" aria-label="Shape sketch. Drag visible control points or edges to change the shape. Scroll to zoom. Middle or right drag to pan."></canvas><div class="shape-canvas-legend" aria-hidden="true"><span><i class="shape-upper-key"></i>Upper / far</span><span><i class="shape-lower-key"></i>Lower / near</span><span><i class="shape-linked-key"></i>Linked pair</span></div></div>
<div class="shape-sketch-footer"><label class="consent shape-snap-control"><input id="s-snap" type="checkbox" checked title="Snap to nearby points, edges and grid. Hold Alt to move freely.">Point &amp; grid snap</label><label class="shape-grid-step">Step<input id="s-grid-step" type="number" min=".001" max="100" step=".01" value=".1" aria-label="Grid snapping step in model units"></label><span class="shape-mouse-hint">Scroll to zoom · right-drag to pan</span></div>
<div id="s-canvas-status" class="shape-canvas-status" role="status" aria-live="polite">Drag a point or edge to shape the selected object.</div>
<details class="shape-reference-controls"><summary>Trace an image</summary><div class="shape-reference-actions">${button('s-reference','Choose image','Load a local reference image behind the sketch')}<input id="s-reference-input" type="file" accept="image/png,image/jpeg,image/webp" hidden><label class="field">Opacity<input id="s-reference-opacity" type="range" min="0" max="1" step=".05" value=".25"></label>${button('s-reference-clear','Clear','Remove the tracing image from this editing session')}</div><p class="helper">Save a shape draft to retain this image. The local autosaved document and exported JSON recipe keep shape data only.</p></details></section>
<section id="shape-stage" class="shape-stage" aria-label="Live 3D shape preview"></section></div>`;

export const shapeInspectorMarkup = `<div class="eyebrow">SHAPE SCENE</div><h2>Keep every curve.</h2><div id="s-state" class="shape-status" role="status">Your recipe keeps the profile, points and objects editable.</div>
<label class="field">Find an object<input id="s-search" type="search" placeholder="Filter shapes" autocomplete="off"></label><div id="s-object-list" class="shape-object-list" role="listbox" aria-label="Shape objects"></div>
${pair(button('s-duplicate','Duplicate','Create an independent copy of the selected shape'),button('s-delete','Remove','Remove the selected shape; Undo is available'))}
${pair(button('s-hide','Hide / show','Toggle the selected shape’s visibility in the 3D preview'),button('s-lock','Lock / unlock','Prevent changes to the selected shape while keeping it in the scene'))}
<label class="field">Object name<input id="s-object-name" maxlength="120" placeholder="Shape name"></label>${button('s-rename','Rename object','Rename the selected shape in this scene')}
<div class="shape-colour-row"><label class="field">Colour<input id="s-colour" type="color" value="#8bb8c9"></label>${button('s-material','Apply colour','Apply this colour to the selected shape')}</div>
<dl id="s-stats" class="stats shape-stats"></dl>${pair(button('s-undo','↶ Undo','Undo the last edit'),button('s-redo','Redo ↷','Restore an undone edit'))}
<div class="shape-save-card"><label class="field">Shape draft name<input id="s-title" maxlength="160" value="Untitled shape" placeholder="Name your shape scene"></label>
${button('s-save','Save shape draft','Save the editable recipe together with its generated mesh','primary')}${button('s-builder','Save &amp; edit in Builder','Save this shape, then open a mesh copy in Builder for cuts, sculpting and materials')}
<p class="helper">Reopen a shape draft to keep editing its curves. Builder edits make a separate mesh draft.</p></div>
${button('s-download','Export GLB ↓','Download the complete shape scene as a GLB, including hidden objects')}${pair(button('s-export-recipe','Export recipe','Download the editable Shape Lab recipe as JSON'),button('s-import-recipe','Import recipe','Open an editable Shape Lab JSON recipe'))}<input id="s-recipe-input" type="file" accept="application/json,.json" hidden>
${button('s-new','New shape scene','Start a fresh Shape Lab scene after checking unsaved changes','text-button')}
<p class="helper">The recipe stores all objects, dimensions and point links. Export GLB for other tools; keep the recipe for future shape edits.</p>`;
