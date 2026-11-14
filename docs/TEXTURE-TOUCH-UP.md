# Texture touch-ups and android repair · 3D Lab 0.22.0

This update starts from creative-suite-20261018-232123.zip, reused with the user's
explicit confirmation that the source has not changed. The repaired android uses
that package's revision 7 rig and the previous repair's UV atlas. No cApp owner,
AI runtime, weights, native game code or live project registry is changed.

## Paint after baking or rigging

Open the saved model in the inspector and choose **Touch up texture**. This is also
linked from Builder's Texture panel; save Builder changes before opening the saved
model. The texture editor works directly from the complete GLB, including skins.

- **Focus detail**: click the face, ear or another feature to zoom in. Repeating
  focuses further. Front/Left/Right/Back preserve your focus and zoom; Fit resets it.
- **Paint**: pick a colour or use **Pick colour** on the model. Adjust radius,
  strength and soft edge. The visible circle shows the brush radius.
- **Erase paint** reveals the base texture. Layer opacity and Show paint layer let
  you compare your work. Undo/Redo operate on completed strokes.
- Alt-drag or **Orbit** rotates; right-drag pans; scroll zooms. Ctrl/Cmd-scroll stays
  available to the webview. On touch devices, choose Orbit to navigate.
- **Save asset** makes a revision on the existing disk asset ID. **Export GLB** keeps
  the composite colour image and editable paint layer in one portable file.

The brush follows the surface in model space, including across UV islands, and
uses a depth snapshot to reject hidden surfaces. Painting uses the base-colour
image's existing UV channel and transform. Shared/mirrored UVs share their paint;
UVs outside the first tile are skipped. Give separately painted surfaces unique,
un-tiled UVs first. This edits colour, not normals, roughness or geometry. A colour
image shared with another material channel must be separated before painting.

The original image and the transparent paint layer are embedded as buffer payloads
under the optional `cappTextureLayers` metadata. Standard glTF readers render the
ordinary composite PNG. Repeated touch-up saves reuse their layer buffer slots.
Every non-image accessor buffer is copied exactly; no mesh exporter normalizes
weights, rebuilds skins or drops actions. Undo stores changed texture tiles, up to
12 strokes within a 32 MiB target, retaining at least the latest stroke.

Touch-up saves and exports retain editable layers. Other editors that re-export a
mesh, including geometry/animation workflows, may flatten the layer into its
composite texture. Keep the layered GLB or an earlier disk revision as the editable
master. The existing material-image decoding limits still apply.

## Automatic bake sweep

The existing source baker chose a view from face orientation and depth, even when
its projected pixels were transparent. It now checks alpha confidence at the face
centre and three inset corners, and excludes empty source regions from view
selection. Faces without usable source evidence retain their previous materials.
Per-view settings, UV channels, unrelated maps and undo behavior remain intact.

This improves missing-source handling. It does not automatically register facial
features or solve different poses between character sheets. The generic baker still
selects one view per triangle and can leave seams between inconsistent references.
The repaired android was separately registered to head landmarks and blended across
continuous regions; that manual registration is recorded with the model and in
its supplied repair recipe. It is not claimed as a new automatic AI capability.

## Android v2

The previous repair swapped and mirrored the asymmetric side sheets and used
whole-body registration for the head. This put the ear behind the actual ear and
left a hard cheek/jaw transition. The replacement uses the left sheet on +X and the
right sheet on -X without mirroring, with ear, eye, nose, chin, skull and neck
landmarks. Smooth regional weights replace the abrupt head view boundary. Atlas
gutters are extended to avoid thin lines between UV islands. The existing body bake
is retained below the neck transition; mismatched arm poses make a global side
projection unsuitable. Some source lighting and body stretching remain.

All 456,408 triangles, 34 unique joints, skin weights, 10 nonempty animation clips
and the complete editable action document (including its empty initial Action)
are preserved. Neither anatomy nor mesh shape was changed to hide projection errors.
The main GLB embeds its 4096-pixel texture. Original reference images are included.

## Activation and checks

Run the supplied updater against the existing 3D Lab source folder, then freshly
Compile/Package 3D Lab under the same app identity. The prebuilt index.html is
included. No cApp owner rebuild is required by this update. Optional Foundry and
Kestrel paths refresh only their hosted 3D Lab HTML copies, with backups.

The update manifest checks every supplied source baseline and every incoming hash
before writing. Unknown/new source conflicts stop the updater. Existing hosted HTML
was omitted from the work package, so those explicitly selected generated copies
are backed up before replacement rather than compared with an invented baseline.

Verification is recorded in TEXTURE-TOUCH-UP-VERIFICATION.json: original mesh/skin
and clip data, real android brush/undo/export, same-ID disk save/reopen/erase,
responsive dialog, material/baker checks and browser deformation comparison.
Browser rendering uses software WebGL. Native compilation, installed Windows /
WebView2, CUDA, performance and gameplay acceptance were not run.
