Texture touch-ups: 3D Lab 0.22.0 adds **Touch up texture** in the asset inspector,
with a separate erasable paint layer that preserves rigs and animation. See
[TEXTURE-TOUCH-UP.md](docs/TEXTURE-TOUCH-UP.md) for editing, activation and limits.

# 3D Lab 0.20.1 · GLB recovery and fitted workspaces

Repairs advanced-model GLB export through Local AI 0.23.1 and retains completed
invalid output for recovery. Workspaces fit the screen with independently scrolling
panels. Ctrl+wheel is reserved for page zoom; normal wheel still zooms the model.
MCP 0.24.27 and Links 0.6.0-alpha.2 enable native Windows page zoom by default.
Rebuild/restart cApp, freshly Compile/Package the Lab and keep existing identity,
Files/Links settings, shared drafts and model weights.
See [the repair, workflow and limits](docs/GLB-VIEWPORT-ZOOM.md).

# 3D Lab 0.20.0 · textures, glass and source-image baking

Builder now embeds surface maps and physical glass materials in saved/exported
GLBs. Texture from source images bakes one reference or all retained views onto
visible surfaces without adding triangles. Source drafts remain unchanged.
Hunyuan reference padding and saved processing details support repeatable detail
comparisons; this is not a verified fix for wavy generated geometry.

Rebuild/restart cApp with Local AI 0.23.0 / MCP 0.24.26, then freshly Compile and
Package this Lab using the existing app identity and Files/Links settings. Keep
model weights and shared assets. See [the workflow, methodology and limits](docs/TEXTURES-AND-GENERATION.md).

# 3D Lab 0.19.2 · mesh counts

Generated and imported meshes no longer have fixed vertex or triangle-count ceilings.
Builder scene/component editing and automatic prediction-copy source admission accept
the detailed model too. The 64 MiB GLB limit remains. Rebuild the cApp owner with
Local AI 0.22.1 / MCP 0.24.25, then freshly Compile/Package this Lab. Existing model
weights, shared folders and rigging fixes are retained. See [mesh counts](docs/MESH-COUNTS.md).

# 3D Lab 0.19.1 · real draft rigging audit

The supplied HOUND now gets four-legged suggestions with its low head, foreleg
pivots and paw joints. New hints for the sweater cat and porter bot separate
ankles/toes and improve the short-legged cat's knee selection. Existing saved
maps stay in place until you review and apply a fresh proposal. Map edits also
preserve already-unit animation rotations exactly.

Audited 66 stored revisions across 47 asset IDs, all 38 distinct GLB payloads,
30 action recipes and 15 distinct joint trees. Read [the findings and follow-up](docs/RIG-AUDIT.md).
This Lab-only update retains shared disk storage, Hunyuan controls, source joints,
weights and existing actions. Freshly Compile/Package the updated index.html using
the same app identity and existing Files/Links/Local AI settings.

# 3D Lab 0.19.0 · animal body labels

Action Lab detects common four-legged layouts and proposes their body roles and
facing. Generic predicted joints get readable labels in the rig list, joint
inspector and parent choices, with the original skeleton retained. Review the
points in **Body map**, choose **Use body map**, then **Save action draft**.
Existing animal rigs can use the same flow without another prediction.

New workflow map nodes default to automatic body/facing detection. Previously
saved explicit settings stay explicit. This is a Lab-only update on top of
0.18.0; keep the existing app identity, Files/Links and Local AI settings, then
freshly Compile/Package the updated index.html. No cApp runtime or model-weight
change is required for this feature. See [animal labeling](docs/ANIMAL-LABELS.md).

# 3D Lab 0.18.0 · Hunyuan detail and memory

Hunyuan 2 mini, 2, multiview and 2.1 now expose 384/512 detail, guidance, decode
batch size and CPU offload. Every generation keeps its settings on disk; Use
reference restores them, and workflow model nodes retain the same controls.
Rebuild the updated cApp owner, freshly Compile/Package with Local AI 0.22.0 and
keep your existing Files/Links settings and app identity. Model weights are reused.
See [the controls and activation notes](docs/HUNYUAN-CONTROLS.md).

# 3d-lab · native shared folders

The installed app uses Files to open shared assets and remembered project folders automatically. See [local Files setup](docs/LOCAL-FILES.md). The launchers documented below remain the optional browser/remote path.

# 3D Lab 0.16.1 · connected disk libraries

The existing disk catalogue remains compatible. Copy its connection into Foundry’s Asset libraries to browse saved drafts by folder. Configured HTTPS connections and storage-aware browser handoffs are supported.

[Setup, migration, folders and recovery](docs/SHARED-ASSETS.md)

---

## Earlier release notes

# 3D Lab 0.16.0 · permanent drafts

Drafts now save to `%USERPROFILE%\cApp\assets\3d`. Read
[Permanent asset storage](docs/DISK-STORAGE.md) for applying the focused update,
starting the local service, and migrating your existing browser drafts.
The browser remains a cache. Keep the existing installed app identity for migration.

# 3D Lab 0.15.1 · pick saved actions in workflows

**Workflows → Generate action batch → + Action** now opens the same starter and
saved-prompt catalogue as Action Lab. Choose one and click **Add selected action**;
its clip name, description, duration and seed are filled in. Each row also has
**Choose another action**. Description editing is optional.

The workflow keeps its own copy. Updating or deleting a saved prompt does not
change an existing workflow. Long prompts require an explicit duration adjustment
when adding them with MoMask.

This is a changed-files update for `3d-lab(9).zip`. Copy only the supplied `3d-lab/`
files into that Lab folder. Built `index.html` is included. See
[changes, installation and segment-smoothing findings](docs/ACTION-PROMPT-UPDATE.md).
The cApp neural stitching code is outside this upload and has not been modified.

---

## Earlier release notes

# 3D Lab 0.15.0 · equipment, shared rigs and workflows

Open **Action Lab → Items & weapons**, **Rig shelf**, or **Workflows**. Equipment has
weight/size guidance, adjustable bone sockets and per-item equip/hold/use/holster
motion starters. Reuse rig recipes and actions across NPCs, or run an editable
node workflow with model consent, automatic local steps and manual review.
**Send to Foundry…** saves and copies the action revision to the connected project.

[Start here and automation API](docs/ACTION-WORKFLOWS.md) · [Verification](docs/ACTION-WORKFLOWS-VERIFICATION.json)

Changed-files update only. Retain the existing project identity and draft storage.
Built browser HTML is included. Installed cApp apps may need repackaging from this
source; the existing AI provider and checkpoints remain unchanged.

---

## Earlier release notes

# 3D Lab 0.14.0 · Foundry project handoff

Project Assets now preserves the selected Foundry folder session and opens a chosen
project revision directly in Action Lab, Shape Lab or the model workspace. Saved
rig/mesh bytes, recipe and project provenance travel together. Existing AI, drafts,
modelling, game preparation and PNG/GIF capture tools are retained.

Rebuild this app's UI normally. This update does **not** change or require rebuilding
the AI owner. Use **Project Assets → Open Foundry** for assembly and sound bindings.
Save a new draft and copy it back to the project to publish your edits.

[Workflow](docs/PROJECT-ASSETS.md) · [Verification](docs/FOUNDRY-VERIFICATION.json)

---

## Earlier release notes

# 3D Lab 0.13.0 · game actions and viewport capture

Prepare actions for Kestrel with loop/one-shot settings, contact windows, named
events, stride measurement and same-body-type action transfer. The existing rigs,
weights, app identity, draft store and AI models remain compatible.

**Camera / GIF buttons** beside fullscreen save a PNG screenshot or animated GIF.
Choose size/background; GIF offers selected-action ranges or a full turntable,
10/15/20 fps, repeat and cancellation. Capture uses a separate skeleton/camera and
does not edit the draft. PNG supports full alpha; GIF uses 256 colours and binary
transparency. Exported GIFs are previews, not game animation files.

For game publication: open an action draft → **Game movement** to prepare the
selected clip → **Game preview** to assign idle and walk/run (plus optional start,
stop, directional, stance and air clips) → **Keep settings** → **Save action draft**.
Copy that draft into Project Assets, assign the same revision to **Model** and
**Movement** on a character ID, then publish with Kestrel 0.35.0.

Rebuild this Lab using a fresh **Compile → Package**, keeping its app identity.
The Kestrel update contains the refreshed browser copy. Voice Lab is unchanged;
the cApp companion update records future plans only and needs no AI/runtime rebuild.

Contacts are review markers, not foot IK. Transfer requires compatible reviewed
human/animal maps and does not repair bad weights or guarantee a convincing gait.
Kestrel owns physics and speed; preview settings do not replace its collision or
movement profiles. Sound playback and sockets remain the deferred next phase.
See [Action Lab](docs/ACTION-LAB.md), [Project Assets](docs/PROJECT-ASSETS.md), and
[verification](docs/VERIFICATION-0.13.0.json). Native Windows/gameplay validation
remains pending under Kestrel's supplied skip-native-validation instruction.

---

## Previous release notes

# 3D Lab 0.12.0 · smarter predicted rigs

This update uses only the newly supplied `3d-lab(8).zip` (SHA256
`c3559c1eae990744d1af4d368531d3c6faf2a7e17fe17aab22ac57a0cbc20191`).
It preserves the existing Project Assets integration, app identity and draft store.

- **Body map** suggests human / four-legged-animal roles from joint names,
  positions and branch paths. Show a role on the model or select a joint and
  assign it. Left/right colours and a facing arrow help check the result.
- **Use body map** records a reviewed mapping. Motion generation receives a
  compact skeleton (up to 21 human / 19 quadruped joints). The full predicted
  rig, detailed mesh, joint names, weights and prior actions stay intact.
- **Position-only retargeting fix:** a mutated rest-direction vector could cancel
  limb rotations while retaining root travel. The resting vector is now kept
  independent. Mapped descendants are found through extra helper bones.
- **Motion check** flags mostly-root-travel locomotion and large adjacent-key
  flips. **In place** anchors only the preview, without editing source keys.
- **Preview a local bend test** creates a separate, explicitly non-AI action
  to check elbows/knees and surface weights before spending time on inference.

## Use your current draft

1. Open the existing action draft. You do not have to predict the skeleton again.
2. Open **Body map**, select person or four-legged animal and the direction the
   model faces. **Suggest body joints**, then check the highlights on the model.
   Correct any missing or mistaken role with its dropdown or **Assign selected**.
3. Tick the review checkbox and **Use body map**. If this is a new UniRig
   candidate, apply it and smooth-bind when ready. Existing bound drafts keep
   their weights; this operation does not rebind them.
4. Try **Preview a local bend test**. If the surface bends badly, adjust joints
   or paint/rebind the weights. Body mapping alone cannot fix a bad skin.
5. Generate a fresh short walking/running action. Use **In place** to see limb
   movement clearly, read any motion warning, then **Save action draft**.

Rest-position/hierarchy changes invalidate body-map review. Missing limbs,
conflicting roles, reversed sides, overlapping mapped joints and unsupported
orientation are reported before generation. Suggestions are deterministic rules,
not an anatomical detector with calibrated confidence. They need review for unusual
poses/proportions, fingers, tails and nonstandard topology. The compact body map is
for humans and four-legged animals; other well-named rigs retain the existing
custom UniMate path. No neural skin-weight model or new checkpoint is installed.

Replace the existing 3D Lab source with this complete folder and freshly
**Compile → Package**, keeping the same app identity. Built `index.html` is included.
No cApp, Voice Lab or Kestrel source was changed. If you use the Kestrel connector's
bundled browser editor, refresh its Lab copy with the existing
`tools/install-project-labs.py` workflow described in `docs/PROJECT-ASSETS.md`.

Validation: full existing Node suite plus 23 new mapping/motion tests, and 13
built-browser checks using controlled animation replies, real IndexedDB and GLB.
Actual UniRig/UniMate/MoMask inference, Windows/WebView2 and RTX behaviour are not
verified by these tests. Existing bad clips are retained; regenerate them after
mapping. See [Action Lab](docs/ACTION-LAB.md) and [verification](docs/VERIFICATION-0.12.0.json).

---

## Previous release notes

# 3D Lab 0.11.0 · shared project assets

**Project Assets** connects to the same Kestrel registry as Voice Lab. Browse stable
game IDs, open models in Create/Builder/Shape/Action Lab, copy saved drafts back,
and assign model, movement and sound revisions. Connected labs synchronize changes.
Right-click a saved asset → **Copy to project workspace**. Existing drafts,
references and the `capp.3d-lab.assets.v1` identity remain intact.

Run the accompanying **Open-Asset-Workspace.cmd** in your full Kestrel folder
(Python 3.10+), then paste its link into Project Assets. If the installed package
blocks loopback access, the hub opens included browser editors already paired to
the project. Those editors do not inherit installed AI providers or personal drafts.

The source share omits the actual Kestrel mesh/WAV bytes; migration reads them from
your full folder. Compatible static replacements can be published. Native skeletal
playback and sound triggers remain runtime adapter work; authoring assignments are
clearly separated from game publication. [Workflow and limits](docs/PROJECT-ASSETS.md).

Replace this Lab source under its existing app identity, then freshly **Compile →
Package**. Rebuilt `index.html` is included. No cApp host patch is supplied.

---

## Earlier workflows

# 3D Lab 0.10.0

## New in 0.10.0: prediction copies and game movement

- **Generate skeleton** automatically prepares a temporary simplified copy for
  UniRig when needed. Progress and cancellation remain available; the original
  detailed geometry, materials, weights and actions are retained. Review the
  predicted joints on the original mesh before applying them.
- **Game preview** above the Action Lab viewport opens a playable character
  sandbox. Assign idle/walk/run actions and optional start/stop/directional clips,
  trim usable ranges, and tune acceleration, braking and transitions.
- Test **WASD**, Shift to run, Q/E to turn, drag to look, third person / first
  person, mapped head/chest look and optional two-hand IK aiming. The repeatable
  NPC test exercises starts, running and coming to rest on the same controller.
- **Keep settings**, then **Save action draft** to retain the movement profile.
  **Game clips GLB** exports separate in-place, trimmed animation clips and the
  full detailed model. **Movement recipe** exports matching baked keys and
  controller settings. Original actions remain editable and unchanged.

This is a flat-ground control preview without collision, physics or foot locking.
AI prompt starters help generate source clips; the controller supplies responsive
transitions. Generated motion still needs visual review. Kestrel integration and
workspace syncing are not part of this release.

Rebuilt `index.html` is included. Replace the existing Lab source, keeping its app
identity, then freshly Compile → Build Windows app. No cApp/native model overlay
is required. See [Action Lab](docs/ACTION-LAB.md), [integration](docs/INTEGRATION.md)
and [verification](docs/VERIFICATION-0.10.0.json).

An independent local 3D workshop for cApp: generate or import a GLB, build a shape
from editable curves, then refine, rig, animate, save and export it. Audio assets and Voice Lab
storage are separate.

## Install this update

Copy this complete folder into your existing **3D Lab source folder**, then freshly
**Compile → Windows Package** using the same project and app identity. Install the
resulting update. Existing drafts and downloaded model weights are retained.

This update changes the 3D Lab interface and asset handoff only. It uses the existing
Local AI 0.21.0 / MCP 0.24.20 setup; no new cApp overlay, model downloads or runtime
changes are included. Keep the animation capabilities already enabled. Manual
rigging and animation do not require an AI model.
See [integration](docs/INTEGRATION.md) for the update sequence.

## Action Lab

Choose **Action Lab → Choose asset** to browse your saved models. Search by name,
folder, tags or notes; filter by model type and sort by newest or name. Select a
card, then **Open in Action Lab**. **Import GLB** opens a local file directly into
this workspace. From **Assets**, right-click a model or use its **⋯** menu and choose
**Open in Action Lab**. Action drafts say **Continue in Action Lab**. The asset
inspector also offers this action.

The model card always identifies the open source. **Your next step** explains the
current scene and provides shortcuts for human, animal and mechanical workflows.
Its checklist covers joints, attached geometry, keyed actions and saving. It also
flags generic joint names and parts that will remain still. These checks describe
the data present, not whether anatomy or animation quality is correct.

Switching models offers **Save and switch**, **Discard and switch**, or **Cancel**
when Action Lab has unsaved edits. A failed save or import keeps the working scene.
Selecting the same model resumes the current edits. Navigating to Assets retains
the Action Lab session in memory; save explicitly before closing the app.

You can still use the practice human or animal to learn the controls.

- **Rig:** fit a humanoid/quadruped template, or place connected joints directly on
  the model with visible surface, vertex or edge tracking. Set a placement depth,
  move joints inside the mesh, mirror chains, and edit hierarchy and constraints.
- **Bind:** calculate smooth weights, refine them with a visible brush and colour
  preview, or rigidly attach separate ship parts. Two clicked points define a hinge
  axis; hinge/slider limits support doors, turrets and landing gear.
- **Animate:** pose with handles, numeric controls or IK. Pose edits add keys at the
  timeline position. Name, duplicate, reverse, loop and play actions; import BVH.
- **Keep the action:** save an editable action draft, reopen its rig and clips, or
  export an animated GLB containing all named actions. Original assets are preserved.
- **Local AI motion:** UniMate accepts one named 5–70-joint rig and 0.5–60 seconds
  at 30 FPS. Its checkpoint remains **CC BY-NC 4.0 (non-commercial)**. The existing
  0.8.0 integration includes corrected skeleton conditioning, official sampling and continuation,
  and the conversion from model bone-edge rotations to joint deformation.
  MoMask provides a separate HumanML3D humanoid motion model, 0.5–9.6 seconds at
  native 20 FPS. Review each generated action; matching names or completed inference
  do not establish good movement, contacts or deformation.
- **AI skeleton:** UniRig predicts joints from a mesh without an existing rig.
  Review and edit the candidate, then apply it unbound or explicitly calculate
  smooth weights locally. Discard restores the previous rig, weights and actions;
  applying is undoable. UniRig does not predict skin weights in this integration.
- **Prompt workshop:** 16 short, single-action human/animal starters use “A person runs forward.” for people and “An object runs forward.”
  for animals. UniMate adapts the subject to its training caption style. Edit and save named prompts with
  duration and seed, update or copy them, and import/export your library. UniMate's
  guidance control is 1–7, default 3. Generated actions still need **Save action draft**.

Since 0.8.0, automatic binding assigns each bone segment to the joint at its starting pivot.
This fixes forearms following wrists and shins following ankles. Existing saved
weights are preserved: for an older automatic binding, choose **Rig → Binding scope:
All mesh parts → Bind with smooth weights**, inspect the result and save a new draft.
Rebinding replaces painted weights in the selected scope and can be undone.

Fullscreen keeps the timeline and tool panels available. The camera uses WASD,
Q/E and R/F; Space plays, K keys the pose, and Ctrl/Cmd+S saves a draft. Unsaved work
is kept while moving between workspaces but is not automatically saved across reloads.
See [Action Lab workflows and limits](docs/ACTION-LAB.md).

## Shape Lab

Open **Shape Lab** to start with an editable hull or resume the locally retained
document. No AI model is needed.

- **Paired profiles:** hull, wing, fin, canopy, panel and support presets. Drag visible
  points or edges in Side/Top views, with nearby point/edge/grid snapping and live 3D
  feedback. Link opposite points or move them independently along the length and reach.
  Add/remove stations, set pointed/flat ends and adjust dimensions, curves and roundness.
- **Drawn solids:** click a closed outline to build an extrusion or full 360° revolution.
  Extrusions support bevel, taper and twist. Insert/remove points, subdivide edges and
  use exact local coordinates. Self-crossing outlines are rejected without losing the
  previous solid; separate hole contours are not supported in this version.
- **Formula curves:** safe arithmetic expressions such as `sin(pi*t)` become editable
  stations. Choose the upper, lower, width or symmetric profile and refine it by hand.
- **Shape scenes:** searchable objects, rename, duplicate, remove, hide/show, lock,
  colour, numeric move/rotate/scale and axis mirrors. A tracing image can sit behind
  the sketch; saving a draft retains it alongside the recipe.
- **Workspace controls:** Split/Sketch/3D layouts, fullscreen with Tools/Objects
  panels, visible point tracking and a **?** keyboard guide. The sketch supports
  mouse editing, keyboard nudges, pan and zoom; the focused 3D view uses WASD/QE/RF.
- **Editable saving:** Save shape draft stores the recipe and mesh as a new asset.
  Reopen it to continue editing. Export/import JSON recipes, export GLB, or choose
  **Save & edit in Builder** for mesh cuts, sculpting and materials. Builder edits
  preserve the original shape recipe and are saved as separate mesh drafts.

Undo/Redo retains up to 40 recipe states during the open session. The local autosaved
document survives a reload, but its Undo history, unfinished outline and tracing image
are not part of that session JSON. Save a draft for a retained image; export the recipe
for portable editing. Shape Lab supports 64 objects, 128 points per polygon, 33 profile
stations, 500,000 scene triangles and 2 MiB recipes.

See [Shape Lab workflows, controls and implementation limits](docs/SHAPE-LAB.md).

## Builder

Open a saved asset and choose **Edit in Builder**, or use its right-click menu.

- **Outline cuts:** the old box cutter is replaced by visible surface points and
  connected lines. Hover to see the snap, click 3–64 points, then click the green
  first point or press Enter. The enclosed piece becomes a new object in the same
  scene. Depth controls distinguish one wall from a through-object cut. Works
  before or after inner-wall generation; Backspace removes a point and Escape cancels.
- **Objects:** searchable scene list, multiple selection, rename, focus, hide/show,
  isolate, lock, duplicate, merge, separate connected islands, mirror and ground
  placement. Add Box, Sphere, Cylinder or thin solid Panel shapes.
- **Transforms:** visible Move/Rotate/Scale handles, optional snapping and numeric
  transforms around the selected parts' centre. Materials offer replacement colour,
  roughness and a simple transparent Glass preset.
- **Clean up:** remove degenerate triangles, weld compatible vertices, rebuild normals,
  reduce polygons using constrained quadric-error edge collapse, centre, size and rotate.
  UV/material seams, borders and sharp features constrain the achievable reduction.
- **Interior:** generate inward-facing hull walls and opening reveals, then place
  separate floors and partitions with explicit dimensions. Room layout remains manual.
- **Sculpt:** Smooth, Inflate, Deflate and Flatten with a visible surface-aligned brush
  ring. Left-drag applies the selected brush; [ and ] resize it. Each stroke is one Undo.
- **Texture and inspection:** project the retained reference image; inspect with
  Clay/Flat/Wireframe and section planes. Remove projections before further topology
  or sculpt edits. Projection cannot invent unseen texture detail.
- **Fullscreen and keyboard:** corner-brackets control at the viewport's top right;
  tool strip and Tools/Objects panels remain available. Click the canvas for WASD
  movement, Q/E turning, R/F vertical movement and arrow-key looking. **?** opens the guide.
- **Save/export:** Save edited draft creates a new asset. Full-scene export retains
  hidden pieces; selected-object export downloads just the selection. Tool helpers
  and inspection clipping are never part of the exported mesh.

Undo/Redo holds up to eight steps within a 96 MiB geometry-history budget. Save milestone
drafts. The original asset is preserved, and failed operations retain the working scene.
Unsaved history is not a substitute for a saved draft. Cuts/shells support 350,000 source
triangles per part; scenes have no fixed vertex or triangle-count ceiling, with 64 MiB per GLB.

See [Builder workflow, controls and geometric limits](docs/BUILDER.md).

## Generation and inspection

Nine model choices remain visible with their memory requirements. TripoSR, TripoSG
and the four Hunyuan shape variants have runtime implementations. SF3D, SPAR3D and
TRELLIS.2 retain their explicit setup-pending states. This update does not add those
missing generation runtimes, authenticated model downloads or project-production writes.

**Have several views? Use multiview** selects Hunyuan3D 2 multiview: a front image plus
separate left, back and/or right images. This is the dedicated multiview shape model;
Hunyuan 2.1's shape model remains single-image. Top/bottom images are not inputs to
that generator. Small previews show which reference occupies each slot. Existing
model-specific preparation and licence acceptance requirements still apply.

The single viewport attempts automatic recovery after a lost WebGL context. **Restore
preview** recreates it while retaining the mesh, unsaved edits and camera. Rendering
resolution is conservative and drops after recovery. This cannot guarantee that a
Windows GPU driver will avoid a reset during neural generation.

The base64 stack-overflow fix from 0.2.1 remains included. Import/preview supports
self-contained triangle GLBs up to 64 MiB, including validated skeletal skins and
animation. External resources, compressed mesh decoders, morph targets and oversized
geometry are rejected with feedback. Action Lab uses skeletal animation; fit or
create a rig for static geometry.

## Source and verification

`index.html` is a ready-built self-contained application with local Three.js 0.160.1.
No runtime CDN or new dependency is needed. The 21 extracted SOL Explorer modules and
original source hashes remain in `docs/EXTRACTION.json`; Shape Lab now uses the shared
profile kernel in its editable workspace.

Build: `npm ci`, `npm run build`. Focused checks: `npm test`.
Browser scripts include app, Builder and Shape Lab checks; provide explicit
`PLAYWRIGHT_PATH` and `CHROMIUM_PATH`. See [verification](docs/VERIFICATION-0.10.0.json) for
observed results and outstanding Windows checks. The new asset workflow uses real
GLB parsing and IndexedDB in browser checks. Model inference evidence from 0.8.0
remains historical; this interface update does not rerun or change the models.

Draft identity remains `capp.3d-lab.assets.v1`. Preserve application identity on update.
Download important drafts before clearing app data. See [integration](docs/INTEGRATION.md)
for the earlier native-generation setup.

## Selective work packages

See [creative suite work packages and scenes](docs/CREATIVE-SUITE.md). Run
`zip-creative-suite.cmd` to package current source and explicitly selected assets.
