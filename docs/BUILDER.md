# Builder · 3D Lab 0.20.0

Open a saved asset and choose **Edit in Builder**. Work takes place in an editable
scene; the original draft and its GLB bytes are retained. Save updates this asset; Save as new asset creates a variant.
The old box cutter has been replaced by a visible, surface-snapped outline tool.

## First window cut

1. Select the hull in the viewport or **Scene objects** list. Use the name filter
   when a scene contains many pieces. Orbit until the window surface faces you;
   **Home** frames the selected object.
2. Open **Cut**, or press **5**. The camera switches to an orthographic view so the
   outline matches the projected cut. Move the pointer over the hull: the live marker
   shows the point the tool will use. **Surface** follows the hit surface; **Nearby
   vertex** and **Nearby edge** snap to a nearby feature on the hit triangle when
   it is close enough, otherwise they retain the surface hit.
3. Click a corner, then the other corners. An orange line joins consecutive points;
   the green first point and closing guide show where the polygon closes. The view
   locks after the first point so all points use one projection direction.
4. Place **3–64 points** around one simple polygon. Concave outlines are allowed;
   self-crossings, repeated/overlapping edges and ambiguous shapes are rejected.
   Drag any existing point to adjust it; clicking the first without dragging closes it. **Backspace** removes the last point;
   **Escape** cancels the unfinished outline without changing the mesh.
5. Choose **Depth from outlined surface** for a window through one wall. Set enough
   depth to reach through that wall, but not through the opposite hull. For a fully
   shelled part the initial depth is increased using its recorded wall thickness;
   inspect and adjust it for the surface you are cutting. **Through selected object**
   reaches every layer of that object behind the outline, including the far side.
6. Click the green first point, press **Enter**, or choose **Separate outlined
   piece**. The enclosed piece becomes a separate object in the same scene.
   **Move separated part aside** is on by default to make the opening visible.
   Turn it off to retain the piece in its exact original position, then hide or
   move it yourself. The new piece is selected after a successful cut.
7. Select the hull again for another opening. Rename the detached object as a
   window or door. It can be transformed, hidden, exported separately, or given
   the physical **Glass** material. **Undo** restores the pre-cut scene.

The boundary is the outline projected into the fixed view plane and extruded through
the chosen depth. Depth runs along that view direction, not along each point's
different surface normal. This is not a freeform path following arbitrary curvature.
Face the working area as directly as possible and inspect the cut from another angle.
Changing camera or selection is blocked until the outline is finished or cancelled.

## Cutting before and after inner walls

Both orders are supported:

- **Cut the exterior first:** separate a surface panel from the unshelled hull, then
  select the hull and **Create inner walls**. The shell operation joins the outside
  to the inside around existing openings. The detached panel remains a separate
  surface; you can give it thickness separately if needed.
- **Generate inner walls first:** select the shelled hull, draw an outline and cut
  through the wall thickness. The cut creates complementary wall-edge faces so
  the window opening and detached piece retain the appropriate thickness.

In the implementation, unshelled exterior cuts use `cap: false`. A recognised Builder
shell uses `cap: true`; closed, consistently wound topology is required for complete
caps. Open input retains open boundaries and reports that limitation. This distinction
avoids filling an exterior opening with a solid plug before a shell exists. An ambiguous
cross-section or an uncloseable wall cut fails without replacing the working object.

## Recommended ship workflow

1. Set the real scale in **Clean up** if known. GLB uses metres, but a generated
   mesh around two units across has no inferred physical scale. All geometry fields
   use model coordinates. Centre, orient and inspect before entering wall dimensions.
2. Clean the mesh and reduce its polygon count. **Keep triangles** means percentage
   retained. Check the cockpit, wing edges and silhouette after reduction.
3. Use the outline workflow to separate windows, doors and removable panels. Add
   inner walls either before or after the cut, as described above.
4. Add separate floors and partitions in **Interior**. Presets provide starting
   dimensions from hull bounds; adjust their positions and sizes to fit.
5. Use **Section inspection** and its slider to look inside. Sections clip only the
   preview: they do not remove geometry or appear in exports.
6. Sculpt while topology is still editable, then apply textures or bake source
   references. Legacy image overlays remain available separately and must be removed
   before further cuts, sculpting or the new source bake.
7. Save milestone drafts. The saved scene contains the separated pieces, including
   hidden pieces, and the original reference and edit history where available.

## Objects, transforms and materials

Click a visible part to select it. Ctrl-click (or Command-click) in the object list
adds/removes parts from the selection. The list shows hidden and locked state; filter
by object name, rename the selected part, or use **Focus**, **Hide / show**, **Isolate**
and **Show all**. Hidden and locked objects are not brush/cut targets. A locked object
can still be selected from the list and unlocked; locking prevents edits, not viewing.

**Move**, **Rotate** and **Scale** show draggable handles on the selection. Numeric
**Move by**, **Rotate by · degrees**, and **Scale factors** apply an incremental
transform around the selected parts' combined centre. **Snap transforms** snaps the
gizmo to the chosen move step, 15° rotation increments and 0.1 scale increments.
Numeric input is explicit and does not need that snapping option.

Additional tools are **Duplicate**, **Mirror X/Y/Z**, **Place on ground**, **Merge**,
**Separate islands**, and Box/Sphere/Cylinder/Panel primitives. A panel is a thin solid,
not a zero-thickness plane. Mirror preserves face winding. Merge retains materials and
UVs without welding away the individual surface detail; show hidden selected parts
before merging. Separate islands finds edge-connected surfaces and joins coincident
vertices across shading/UV seams for connectivity. It does not infer semantic ship
parts from an otherwise connected hull. Keep at least one object in the scene.

**Material** applies tint, roughness, metalness and opacity to selected parts while
retaining texture maps. Clear/frosted **Glass** uses physical transmission, IOR and
optical thickness with standard GLB export extensions. Clay, Flat and Wireframe remain
inspection-only. The Texture panel supports image maps, Box/planar UVs and baking
visible source colours from one or all retained reference views without adding
triangles. See [textures and source-image baking](TEXTURES-AND-GENERATION.md) for the
workflow, supported maps, alignment and receiver limitations.

## Visible sculpting brushes

Select a part, then **Sculpt** or **6**. Hover over it to see the surface-aligned ring
and centre marker. The ring follows the pointer and represents the brush radius.
Choose **Smooth**, **Inflate**, **Deflate** or **Flatten**, adjust strength, then
left-drag on the surface. **[** decreases radius and **]** increases it.

Each completed stroke is one Undo step. A cancelled or failed stroke restores its
starting snapshot. The brush follows a connected, nearby facing surface rather than
reaching through to a disconnected back wall. Fine work needs sufficient vertices;
very dense geometry costs more per stroke. Alt-drag or middle-drag orbits, and
right-drag pans, when no outline is in progress.

## Camera, fullscreen and keyboard

The corner-brackets button at the top right of the 3D zone expands the workspace.
The tool strip stays available; **Tools** and **Objects** open its side panels.
Use the same button to restore the windowed layout. A fixed workspace fallback is
provided when the browser/desktop shell does not expose native fullscreen.

Click the 3D canvas before using movement keys. Typing in a field does not move the
camera, and camera movement stops on focus loss. **?** opens the on-screen keyboard
and mouse guide. Drawing an outline temporarily locks camera movement.

| Key or gesture | Action |
| --- | --- |
| W / S | Move forward / backward |
| A / D | Move left / right |
| Q / E | Turn left / right |
| R / F | Move up / down |
| Arrow keys | Look up / down / left / right |
| Shift while moving | Move faster |
| Control while already moving | Move slower; ordinary Ctrl shortcuts remain available |
| Home | Frame selected object |
| 1 / 2 / 3 / 4 | Select / Move / Rotate / Scale |
| 5 / 6 | Outline / Sculpt |
| Enter | Finish the current outline |
| Backspace | Remove its last point |
| Escape | Cancel an unfinished outline or active editing gesture |
| [ / ] | Decrease / increase brush radius |
| Ctrl+S | Save asset revision |
| Ctrl+D | Duplicate selected parts |
| Ctrl+Z | Undo |
| Ctrl+Y or Ctrl+Shift+Z | Redo |
| Delete | Remove selected parts |
| H / Shift+H | Toggle selection visibility / show all |
| Alt-drag or middle-drag | Orbit while tools are active |
| Right-drag / wheel | Pan / zoom |
| ? | Keyboard and mouse guide |

Command substitutes for Ctrl on supported edit shortcuts. Save/download and geometry
operations require the current outline or gesture to be finished or cancelled first.

## Geometry limits and algorithm behaviour

Reduction uses constrained quadric-error edge collapse. Cleanup removes invalid or
degenerate faces, welds compatible vertices and rebuilds smooth normals. Seams, borders
and sharp features constrain reduction, so the exact requested count may not be
reachable. These operations are not automatic quad retopology or a general repair of
every non-manifold mesh.

Outline cuts clip actual triangles at the projected polygon/depth boundaries and
interpolate UVs, colours and normals. They do not select whole triangles by centroid.
Selected-object cuts and shells support up to **350,000 source triangles**. Island
separation also has a 350,000-triangle input limit and normally allows up to 256 islands.
The scene has no fixed vertex or triangle-count ceiling; the **64 MiB GLB** limit remains. Failures
leave the prior working scene intact; simplify the part or outline and retry.

The shell offsets topology vertices inward, reverses inner faces and connects boundary
edges. Local thickness can be reduced near folds or sharp corners; feedback reports
the achieved minimum. Remote concave surfaces may still intersect. Invalid/non-manifold
topology is rejected rather than silently labelled repaired. Inspect the result inside
and outside. Interior room layout remains manual: the tools do not generate habitable
compartments, engineering clearances or a game-ready collision system automatically.

Reference projection adds a thin image surface over eligible exterior triangles,
leaving the original material under transparent pixels. Visibility uses a 512px
orthographic depth raster sampled at triangle centres, so narrow occlusion boundaries
can be imperfect and oblique surfaces can stretch. The overlay adds triangles. This is
not generated unseen texturing, PBR reconstruction or a full UV unwrap. Remove overlays
before topology/sculpt edits to avoid retaining an image sheet across a new opening.

## Save, export and recovery

**Save asset** updates the current asset ID with a new immutable revision.
**Save as new asset** creates a separate variant. References, source identity/hash
and edit-history labels remain provenance, not a replayable modifier stack.
Renaming offers rename or duplicate-and-rename; see [save identity and history](CREATIVE-SUITE.md).

**Download full scene** retains every object, including hidden ones. Builder visibility
and lock metadata accompany the geometry; other GLB viewers may display retained
hidden objects because they do not interpret Builder metadata. **Export selected GLB**
downloads only the selection. Tool markers, transform handles, brush rings and preview
section planes are never exported. Export is also available before saving a draft.

Undo keeps up to eight CPU snapshots within a 96 MiB geometry-and-texture history budget, retaining
one usable previous state even when it is larger. Undo history is not persisted when
the app closes; saved drafts are. Save failure retains the working scene and leaves
the edited GLB downloadable. Save at useful milestones rather than relying on a long
unsaved session.

On WebGL context loss, CPU geometry and editor history remain in memory. Automatic
restoration re-uploads resources at a lower pixel ratio; **Restore preview** recreates
the renderer if needed while retaining the model, camera and edits. This does not
eliminate GPU/driver resets. Windows WebView2 and generation alongside rendering still
need on-device checking.

## Multiview generation remains separate

Select **Hunyuan3D 2 multiview** (also available via **Have several views?**) for separate
front, left, back and right images of the same consistently oriented object. The main
image is Front; add at least one extra view. Top/bottom images are not sent to this
generator. Other model choices retain their own single-image contracts; images are
not silently combined into an unsupported grid. Hunyuan3D 2.1 shape remains single-image.

The earlier upstream contract references remain:

- https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/hy3dgen/shapegen/preprocessors.py
- https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/examples/textured_shape_gen_multiview.py

The existing sidecar, model preparation and licence acceptance requirements still apply.
Builder 0.4.0 does not add model runtimes or authenticated model downloads.

Current [texture alignment and large-asset update](TEXTURE-ASSETS-UPDATE.md)
covers visual per-view alignment, visible previews and GLB admission.
