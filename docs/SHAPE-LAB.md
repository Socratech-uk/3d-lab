# Shape Lab — 0.5.0

Shape Lab builds editable 3D objects from paired profiles or a closed 2D sketch.
It runs locally without an AI model, inference engine or model download. The sketch
and 3D preview update together, and the saved recipe retains the controls that made
the mesh. Shape Lab does not reconstruct an editable profile from an arbitrary GLB;
use Builder for mesh editing.

## Start a shape

Open **Shape Lab** in the main navigation. The workspace starts with a streamlined
hull, or restores the last locally retained shape document. Choose **Build from**,
a starting shape and **+ Add shape** to add a separate object. **Reset selected to
preset** changes the selected object's profile or sketch; Undo restores the previous
version. It is not necessary to generate or import an asset first.

The three shape types are:

| Type | Editable source | Result |
| --- | --- | --- |
| Paired profiles | Upper/lower and far/near curves along a length | A closed lofted hull, wing, fin, canopy, panel or support |
| Closed sketch | One simple closed polygon in XY | An extrusion along Z, with optional bevel, taper and twist |
| Radial sketch | One closed radius/height polygon | A full 360° revolution around Y |

**Split**, **Sketch** and **3D** change the workspace layout. The bracket button in
the top-right corner of the 3D preview opens fullscreen. Fullscreen retains layout
switches and Tools/Objects panels. It has a fixed-layout fallback for shells without
the browser Fullscreen API. The **?** button opens the keyboard and mouse guide.

## Shape a paired profile

Use **Side · XY** for height and **Top · XZ** for width. Coloured points identify the
two edges; pair guides show their relationship. Select and drag a point to move it.
Dragging an edge pulls its two endpoint controls together. Hover feedback marks the
current snap position. The selected point is also marked on the 3D preview.

**Point & grid snap** prefers nearby points and edges, then the grid. Set the grid
step for the current model scale. Hold Alt while dragging to bypass snapping. Exact
coordinates are available under **Selected point**. Coordinates in the sketch are
local to the selected object: the Top view's second coordinate is Z, while the Side
view's second coordinate is Y. Scene position, rotation and scale are applied in the
3D preview and export, rather than changing the local editing axes.

The profile has four independent channels: upper, lower, far and near. Each station
owns a point in every channel. Upper/lower form one linked pair; far/near form another.
By default, opposite points move together. **Unlink pair** lets the selected edge
move independently in both length position and outward reach. **Link pair** links
subsequent movement without forcing existing points to become symmetrical. A linked
pair receives the same bounded position/reach change, preserving its existing
asymmetry. One point reaching a limit constrains the pair's movement. **Link all**
and **Unlink all** apply to every pair.

**Mirror this profile** makes both pairs symmetrical: upper is copied to lower, and
far is copied to near, with pairs linked. Use the object mirror controls for a whole
object reflection instead.

Add a station with **+ Add station**, the Insert tool, or a double-click near an edge.
The first and last station remain the endpoints of the station sequence and cannot
be removed. Keep 3–33 stations; all station positions and each channel's control
positions must remain in order, at least 0.002 apart in normalized length. Individual
edge positions remain within 0–1, and reach within 0–4. Interior stations need nonzero
height and width. **Pointed** and **Flat** set an end's cross-section; flat ends are
capped. These constraints prevent folded-over station order and collapsed interiors.

Profile settings control length, height, width, interpolation smoothness and
cross-section roundness. Length divisions range from 8–128; ring divisions range
from 8–48 in multiples of four. More divisions improve mesh resolution; they do not
add editable profile stations. Changes to a point clear its old formula metadata,
because the resulting profile is now a manually edited recipe.

## Draw and build a solid

Choose **Closed sketch · extrusion** or **Radial sketch · revolution**, add an object,
then use **Draw a new outline**. Click connected points and close the outline by
clicking its first point or pressing Enter. Backspace removes the latest drawing
point; Escape discards the unfinished outline. The previous solid remains until a
valid new outline is complete. Drawing while a paired-profile object is selected
creates a separate extrusion rather than replacing that profile.

A sketch needs 3–128 distinct points and nonzero area. It must be a simple contour:
self-crossings, touching edges and overlapping adjacent points are rejected. This
release supports one contour per sketch, without separate hole contours. Closing
the outline builds real solid geometry, not an unfilled viewport line.

Drag a point or an edge to refine the outline. Use Insert, double-click an edge,
subdivide every edge, remove a selected point, or reverse the contour order. Invalid
changes retain the previous valid shape. Each completed drag is one Undo step; a
cancelled gesture restores its starting recipe.

For an **extrusion**, set depth, bevel width, end scale, twist and depth divisions.
The depth is centred on Z. End scale tapers from a factor of one at the back to the
chosen factor at the front; twist rotates the cross-section through the requested
angle around the sketch origin. The kernel uses enough depth divisions to represent
a twist, up to the scene triangle limit. A bevel must fit within half the depth and a
quarter of the sketch's width and height. Narrow or sharp inset intersections are
also rejected. Strong twists and very concave outlines still deserve visual
inspection; the editor is not a general solid-intersection solver.

For a **revolution**, X is radius and Y is height. Draw on or to the right of the
visible vertical axis. The closed contour revolves through 360° around Y; divisions
around the axis range from 8–128. Axis edges collapse into the end topology rather
than creating zero-area faces. Extrusion bevel/taper/twist settings do not apply to
revolution. Partial-angle revolutions are not exposed in this version.

## Curves from formulas

The Formula tab samples an expression into editable profile stations. Choose the
upper edge, lower edge, both width edges, or symmetric upper/lower edges. Use 3–33
samples. `t` (also `x`) runs from zero to one along the length. The output is outward
reach, between zero and four.

Supported syntax is arithmetic `+ - * / ^`, brackets, constants `pi` and `e`, and
`sin`, `cos`, `abs`, `sqrt`, `pow`, `min`, `max` and `clamp`. For example:

| Expression | Profile |
| --- | --- |
| `sin(pi*t)` | Smooth arch with pointed ends |
| `4*t*(1-t)` | Broad parabolic arch |
| `sqrt(max(0,1-(2*t-1)^2))` | Elliptical arch |
| `1-t` | Straight taper |
| `0.35+0.65*abs(cos(pi*t))` | Waisted support |

Use explicit multiplication: `2*t`, not `2t`. Expressions must remain finite and
within range. The parser accepts bounded arithmetic data only; it never evaluates
JavaScript, property access or executable recipe content. Applying a formula changes
the selected edge controls; the resulting points remain editable by hand.

## Arrange objects and trace references

Select a shape in the object list or 3D preview. The list supports search, rename,
duplicate, remove, hide/show and lock/unlock. Colour applies to the selected shape.
The Transform tab provides absolute local position, XYZ Euler rotation in degrees,
scale, axis mirrors and reset. Each object retains its own recipe and transform.
The scene must retain at least one object and supports up to 64 objects.

Locked objects cannot be edited until unlocked. Hidden objects remain in the recipe,
save and full-scene GLB export; show them before editing their geometry. Visibility
and lock metadata survive Shape Lab round trips and transfer to Builder. A generic
GLB viewer may show hidden objects because hiding is an editor state, not deletion.

**Trace an image** loads a PNG, JPEG or WEBP behind the sketch; opacity is adjustable.
It is a visual reference, not an automatic tracing or image-to-shape operation. Save
a shape draft to retain that image with the asset. The local autosaved document and
portable JSON recipe contain shape data only, not the tracing image. Clearing or
changing the tracing image does not change the generated geometry.

## Save, reopen and continue in Builder

**Save shape draft** creates a new immutable asset containing the generated GLB and
validated editable document. An existing draft is preserved when saving a revision;
duplicate names receive a distinct name. Reopen the saved Shape Lab draft to edit its
curves and parameters again. The tracing image, if supplied, is stored alongside the
draft's files.

**Save & edit in Builder** first saves that editable shape, then opens a mesh copy
in Builder. Use the existing visible outline cutter, sculpt brushes, transform
handles, materials and other Builder tools there. Saving Builder edits makes a new
mesh draft with parent provenance. Mesh changes do not modify the original shape
document or reverse-engineer new profile controls.

**Export recipe** downloads a `.shape.json` document for portable editing. Import
validates the entire document and replaces the current scene as one Undoable change.
**Export GLB** downloads all scene geometry, including hidden objects, for other 3D
tools. Preview markers, point guides, grids and the tracing image are excluded. Keep
the JSON recipe for a dependable editable round trip; ordinary GLB import is a mesh
workflow.

Up to 40 recipe states are available for Undo/Redo during the open session. Completed
changes also update a local work-in-progress document. Reopening the app restores
that document, not its Undo history, pending drag or unfinished outline. The image
is not part of this local session JSON. If local storage is blocked or full, the
current work stays open and the UI reports that it needs saving or exporting.

## Keyboard and mouse

Click the appropriate canvas first. Text fields and open dialogs suppress editing
and camera shortcuts. The on-screen **?** guide remains available in fullscreen.

| Focus / action | Control |
| --- | --- |
| Sketch tools | `1` Select, `2` Draw, `3` Insert, `4` Pan |
| Move a point or edge | Left drag |
| Pan sketch | Space + drag, middle drag or right drag |
| Zoom sketch | Wheel, `+` or `−` |
| Fit sketch | Home or `0` |
| Nudge selected point | Arrow keys; Shift larger, Alt finer |
| Bypass snapping | Hold Alt while dragging |
| Finish / cancel drawing | Enter / Escape |
| Remove sketch point | Delete or Backspace |
| Remove latest drawing point | Backspace while drawing |
| Undo / redo | Ctrl/⌘ + Z; Ctrl/⌘ + Y or Shift + Z |
| Save shape draft / duplicate shape | Ctrl/⌘ + S / Ctrl/⌘ + D |
| Focused 3D camera movement | W/A/S/D; R/F vertical |
| Focused 3D camera turning | Q/E; arrow-key look |
| Faster / slower 3D movement | Shift / Control |
| 3D orbit / pan / zoom | Left drag / right drag / wheel |

## Implementation and limits

- `src/shape-lab.mjs` owns UI actions, recipe history, immutable save/export requests
  and transfer to Builder. `src/shape-canvas.mjs` owns visible 2D interaction.
- `src/shape-document.mjs` validates `format: "capp.shape-lab"`, `version: 1`
  documents and the `profile`, `extrude` and `revolve` part types.
- `src/authoring/src/model-format/sol-shape-profile.js` remains the shared profile
  generator, bounded formula parser and independent point-pair implementation.
- `src/shape-geometry.mjs` makes separately owned meshes, bakes object transforms,
  preserves outward winding under mirrored scale and rejects invalid geometry.
- `src/shape-session.mjs` stores the local work in progress under
  `capp.3d-lab.shapes.v1`. It does not replace the saved asset database.
- Saved assets use the unchanged `capp.3d-lab.assets.v1` database: `origin: "shape"`,
  a small `asset.shape` summary and the complete `files.shapeDocument`. Existing
  generation/import/edit records do not require conversion or database migration.
- Documents are limited to 2 MiB, 64 objects, 128 points per polygon and 33 stations
  per paired profile. Generated Shape Lab scenes are limited to 500,000 triangles;
  GLB export must also satisfy the existing 64 MiB static-asset limits.

This update changes only 3D Lab. It keeps the existing generation choices, engine
requirements and model licence handling. No native engine or cApp owner rebuild is
required. Freshly Compile and Package the updated Lab source with the same app/project
identity. Browser and geometry checks do not establish Windows/RTX acceptance.
