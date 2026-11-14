# Actual draft refinements · 0.19.1

The [rigging audit](RIG-AUDIT.md) covers the supplied HOUND, humanoids and bots.
Four-legged heads may be below the pelvis; collar and paw-tip helpers stay in the
full rig. Large-footed/short-legged humanoid proposals distinguish ankle/toe roles.
Existing maps are retained until a fresh proposal is reviewed and applied. Labels
and ordinary save/clone operations preserve already-unit animation rotations
without introducing floating-point changes to the stored keys.

# Action Lab · animal labeling in 0.19.0

**Body map → Auto-detect body & facing** proposes a person or four-legged animal
from the current joint tree and rest positions. It runs automatically on opening
an unmapped rig and after UniRig predicts joints. Animal roles include pelvis,
spine, chest, neck/head, left/right front and back legs/paws, and optional tail.
Generic source names stay visible alongside suggested labels. Search accepts
body roles; the Joint panel and parent choices show the same mapping.

Check the points and forward arrow, correct any role, tick the review checkbox,
and **Use body map**. The accepted labels persist with **Save actions**.
Mapping never replaces existing weights or actions. Undo/Redo restores the map
and review state, including edits that leave the joint IDs unchanged. Prediction
Apply/Discard keeps its existing replacement semantics.

See [animal labeling and limits](ANIMAL-LABELS.md). The sections below also cover
older Action Lab features retained in this release.

# Action Lab — 3D Lab 0.13.0

Action Lab turns a static mesh into a rig with saved, replayable actions. It also
opens validated skeletal GLBs. Start with an asset, or use Practice human/animal
to learn the controls. Finish topology edits in Builder before binding the rig.

## Choose a model and continue a draft

**Choose asset** stays visible above the Action Lab viewport, including the
fullscreen workspace. The chooser lists models already stored in Assets, with
thumbnails, name, type, triangle/file details and saved action counts when known.
Search includes names, folders, tags and notes. Filter by folder or type, and sort
by newest first or name. Results are paged in groups of twelve. Select a card and
use **Open in Action Lab**, or double-click / press Enter on a card. Arrow keys
move between cards. Escape closes the chooser and returns focus.

**Import GLB** accepts a self-contained GLB within GLB format/memory limits. Static geometry begins
with no joints; compatible skeletal GLBs retain their supported skeleton and
clips. Action Lab drafts reopen their matching recipe and geometry together.
Shape Lab drafts open as mesh copies; their shape recipe remains editable in
Shape Lab. Unsupported morph targets, non-bind-pose skins, animated scale and
object-only animation are rejected with an explanation before replacement.

In **Assets**, right-click a card, use its **⋯** menu, or press **Shift+F10** on the
focused card, then choose **Open in Action Lab**. Existing action drafts show
**Continue in Action Lab**. The selected-asset inspector includes the same entry.

The source card names the model actually open, distinguishes practice scenes and
saved action drafts, and reports unsaved edits. Choosing the current source keeps
its unsaved session and Undo history. A different model triggers **Save and switch**,
**Discard and switch**, or **Cancel**. Failed saves keep the prompt and current
work; failed imports do not replace the rig or create an imported draft. Finish an
editing gesture or explicitly Apply/Discard a skeleton candidate before replacing
the scene. Switching is blocked while generation or saving is running.

Leaving Action Lab for Assets keeps the session in memory. Returning through the
Action Lab tab resumes it. Use the explicit asset action or chooser to change its
model. This is not reload autosave: **Save actions** is still necessary before
closing the app. Save updates the current asset ID and retains its previous snapshots. Use Save as new asset for a separate variant.

## A guide for your next step

**Your next step** uses the open scene's actual joints, mesh bindings and action
keys. Expand the guide for a short checklist and choose **Human**, **Animal** or
**Mechanical** to tailor its instructions. The choice only changes guidance; it
does not replace joints, bindings, geometry or actions.

- **Choose model:** use your saved mesh or a practice character.
- **Place joints:** fit a starting structure or place a mechanical pivot. Check
  the front and side views and adjust joint positions inside the body. A template
  fits bounds, not anatomy; a T-pose template still needs fitting to an A-pose mesh.
- **Attach geometry:** smooth weights let characters bend. Rigid attachment keeps
  a door or panel solid as it follows one joint. Unbound parts stay still.
- **Animate and review:** manual poses, imported BVH or optional AI models add keys.
  Preview each action and inspect the surface, contacts and intended fixed parts.
- **Save actions:** retain the mesh, skeleton, weights and all actions together.

Generic/duplicate joint names and partial bindings are called out. They are useful
checks, not automatic anatomical validation. Manual posing remains available when
text-motion naming requirements are unmet. AI motion expects Y-up and facing +Z;
this update does not silently rotate meshes or alter rest poses. Complete substantial
geometry changes in Builder before rigging.

## Characters and animals

1. Open **Rig**, choose the humanoid or quadruped starting structure, and click
   **Fit starting rig**. This fits bounds, not anatomy: adjust joints to the model.
2. Select a parent and use **Place connected joints**. Hovering shows the surface
   snap and a line to the parent; each click adds the next joint. Vertex/edge
   snapping and placement depth help place joints inside the surface. Use Move,
   numeric rest positions, parent settings and Mirror joint chain to refine it.
3. Choose the mesh part or All mesh parts, then **Bind with smooth weights**.
   Select a joint, show its influence, and **Paint weights** to refine the result.
   The surface brush follows the pointer; each stroke is one Undo. This distance
   binding is deterministic and may require substantial correction at shoulders,
   hips, tails and closely spaced limbs.
4. Switch to **Animate**, move the timeline, then rotate a joint or use IK. Pose
   changes add keys automatically. The first change after time zero also records
   the initial pose at zero. K records all joints; Shift+K records the selection.
5. Play, name and adjust the action. Add separate actions for idle, walk or gestures.
   Reverse changes key times; Match loop ends copies the initial pose to the end.
   This does not perform foot-contact correction or collision solving.
6. **Save actions** saves a revision of this asset containing the geometry, weights, rig,
   constraints and every action. Reopen it to continue. **Export animated GLB**
   includes the skeleton and named clips; helper markers and brushes are excluded.

Rig mode changes the rest skeleton. Animate mode changes keyed poses. Locked/fixed
joints stay constrained during direct manipulation and IK. Review existing actions
after substantial changes to the rest rig. Remove-joint and clear-rig operations
detach bindings as described in their confirmation; Undo can restore them.

## Mechanical parts

Cut doors, windows, panels or gear into separate objects in Builder first. In Action
Lab, select a parent/anchor and choose **Pick hinge axis · two points**. The first
point is the pivot; the second defines its direction. Select the moving mesh part
and **Attach rigidly to joint**. Set the hinge axis and angular limits in Joint.

Use a Slider for translation along its axis, with limits in model units. Use a
Fixed joint for an anchor. Rigid binding preserves each part's shape; animate the
hinge/slider through the same timeline used by characters. These tools run locally
without an AI model and are appropriate for ship mechanisms.

## AI motion and skeleton models

Enable the matching cApp animation engine as described in INTEGRATION.md. The motion
composer puts the prompt and action length first; engine setup and variation settings
are collapsible. The rig, bound parts and engine state are shown before generation.

1. Fit and bind a named rig. Open **AI models** and choose a starter from **Start from
   a prompt**. The groups cover people walking/running/crouching, gestures, and animal
   walking/trotting/running/idle actions. Select **Load prompt** to copy it into the
   editor. Merely changing the dropdown does not replace your text; replacing an
   edited draft requires confirmation. **Blank** starts an empty description.
2. Edit **Movement description**, choose **Length**, and give the generated action a
   name. The default is 6 seconds; quick choices are 2, 6, 12 and 30 seconds, with a
   custom **0.5–60-second** input for UniMate. MoMask allows **0.5–9.6 seconds**
   at native 20 FPS; longer quick choices are hidden and an oversized draft is
   rejected, never silently shortened. Prefer one clear movement per prompt.
   An animal starter is a text suggestion, not an automatic change to the rig.
3. Open **Engine & setup**, select UniMate or MoMask and the device, read and accept its licence,
   then **Download & load**. Passive checks do not download files. Automatic chooses
   the available engine device; NVIDIA GPU is recommended and CPU is slower. Model
   changes reset licence acceptance; changing device requires preparing that device.
4. Use **Variation & tips** to set a reproducible seed or choose **New variation**.
   UniMate also exposes guidance **1–7**, default **3**. Stronger guidance can exaggerate
   motion. Use its short caption style, such as “An object runs forward.” For MoMask,
   describe one precise human action, such as “A person walks forward,” and preview
   the full action. Human starters use “A person”; UniMate adapts that subject to its
   “An object” training-caption style. Existing saved/editor prompts are retained.
   Generate becomes available only with a usable named rig, bound geometry, valid
   text/settings, accepted licence and loaded model. The scene's action/key limits
   are checked before inference so an oversized action is not generated needlessly.
5. **Generate action** adds a separate editable action. Existing actions are kept.
   The progress display identifies neural segments; **Stop generation** cancels the
   owned job and discards a late result. A stopped or failed worker must be loaded
   again. Viewport editing is paused during generation and restored afterwards.
6. **Preview action**, inspect transitions and deformation, then **Save draft** to
   keep the rig, mesh and all actions together. A generated result is not a saved
   asset until this succeeds. Saved actions replay without a loaded AI model.


### Rebinding an older automatic skin

The 0.8.0 binder corrects a concrete pivot error: a segment from elbow to wrist
belongs to the elbow/forearm joint, not the wrist joint. The old assignment could
make forearm geometry follow wrist motion and shin geometry follow ankle motion.
New automatic bindings use the corrected ownership and normalized weights.

Existing drafts and painted weights are never automatically overwritten. For an
older automatic binding, choose **Rig → Binding scope → All mesh parts**, then
**Bind with smooth weights**. Inspect shoulders, knees, elbows and feet; paint as
needed and save a new draft. This explicitly replaces the selected weights and is
undoable. Keep a saved copy when retaining hand-painted weights matters.

### Predict a skeleton with UniRig

1. Open an asset in Action Lab; no existing rig or bound geometry is required.
   Choose **Predict skeleton with UniRig** in Rig, or select UniRig in **AI models**.
2. Accept its linked code/model terms and **Download & load**. The wrapper is MIT;
   its point-cloud encoder includes GPL-3.0 code. NVIDIA GPU is recommended (upstream
   15-beam search, at least 8 GB VRAM). CPU uses the same trained weights with one
   sampled sequence and is much slower; that search profile can affect quality.
3. **Generate skeleton** automatically prepares a temporary inference copy if
   the mesh exceeds **20,000 vertices or 40,000 triangles**. A background worker
   welds position duplicates and uses constrained quadric-error edge collapse.
   Progress says when preparation is running; **Stop preparation** cancels it
   before inference and retains the loaded model. The full-quality mesh stays
   visible and is never decimated in place. Prediction uses model coordinates,
   not viewport normalization, and never truncates triangle arrays.
   Preparation has no fixed source vertex or triangle-count ceiling. It targets
   16,000 vertices / 32,000 triangles with headroom, and verifies the engine's
   hard bounds and 12 MiB request limit. Protected borders may prevent reduction;
   that fails visibly with the original model intact. A blocked worker or a
   two-minute preparation timeout also retains the original. Repair/reduce a
   separate copy in Builder if automatic preparation cannot meet the limits.
4. The result opens as an **editable candidate on the original detailed mesh**.
   The review panel shows prediction and original counts when a copy was reduced.
   **Body map** opens with suggested body roles. Choose Person / four-legged animal
   and facing, use Show to highlight a role or select a viewport point and Assign
   selected. Check every mapping, then **Use body map**. Missing/ambiguous roles
   remain visible; no joints are deleted or renamed. Rig and Joint still edit the
   actual rest positions and parents. Generic labels are blocked from AI motion
   until a valid map is reviewed. You can also map an already-saved predicted rig.
5. **Discard candidate** restores the previous rig, weights, actions and history.
   **Apply skeleton** replaces the previous rig/actions and leaves the mesh unbound.
   **Apply & smooth-bind locally** also runs deterministic distance-based skinning.
   Both apply choices are explicit, and one Undo restores the prior rig/actions.
   Skeleton prediction itself does not produce skin weights or animation.
6. Review deformation after binding, refine weights and **Save actions**.
   Saving/export is unavailable until the candidate is applied or discarded.

### Body mapping and motion diagnostics (0.12.0)

The validated optional `bodyMap` v1 in the existing Action Lab recipe stores the
human/quadruped role-to-joint-ID map, authored facing (+Z, −Z, +X or −X), and a
review signature. No database migration is required. Save/export/Undo, GLB embedded
recipes, candidate Discard and immutable draft saves retain the map. It references
the full skeleton: the mesh and skin indices are not reordered or simplified.

Suggestions first respect unique recognised names, then use branch ancestry and
relative joint positions. Rules require an upright Y-up neutral pose; they do not
recognise anatomy from mesh pixels. Fingers, tips, unusually placed roots, crossed
limbs and atypical animals may need manual selections or rest-rig edits. No numerical
confidence percentage is displayed. **Show missing required roles only** helps finish
an incomplete map. Assigning one joint to another role clears its former assignment.

Generation builds a separate parent-ordered conditioning tree with at most 21 human
or 19 quadruped roles, leaving detail/helper bones in the original rig. A temporary
Y rotation makes the request face +Z; incoming positions and world rotations are
transformed back consistently. Source geometry is unchanged. Motion maps canonical
role names back to original IDs; unmapped bones inherit parent motion. They do not
receive independent finger/face animation or inferred twist. Named compatible
starting rigs work without a manual map; other well-named custom rigs retain the
existing UniMate path and its 70-joint limit. A detailed mapped rig can have up to
128 joints while its compact request remains within the model budget.

Required body roles must be distinct, connected in the expected ancestry, use ball
joints, have nonzero mapped bone spans, and agree with the selected sides and up
orientation. Reviewed mappings become stale when rest positions/orientations or
hierarchy/type changes. Intentional joint removal prunes its role; imported dangling
references are rejected. These are structural checks, not proof of valid anatomy.

The position-only retargeter previously mutated `targetRest` while calculating its
desired direction, then used the mutated value as the resting direction. This could
cancel limb articulation while preserving root travel. The two directions now use
separate vectors; descendant lookup skips unmapped helpers. Wrapper scene roots
receive root travel once, rather than moving only a pelvis sub-tree. World-rotation
input keeps the existing world-rest-delta / absolute-world conventions.

**Preview a local bend test** adds a separate 3-second diagnostic action, swinging
left then right elbows/knees and returning to rest. It runs without any AI request,
requires a usable mapped bound rig and has explicit local provenance. It is a skin
and pivot check, not a generated gait. Existing actions remain intact; Undo removes
this diagnostic clip. Full-detail painted weights are never replaced by mapping.

A locomotion-named/prompted action with fewer than two recognisable leg joints
changing by 8° is flagged for weak articulation; substantial root travel (over 5%
of body extent) gets an explicit dragging/sliding message. Adjacent rotations over
90° also warn. Idle/gesture clips are not required to move their legs. Diagnostics
inspect keyed rotation ranges and do not measure contacts, energy or semantic prompt
accuracy. Warnings keep the generated clip editable and persist on re-selection via
recalculation. **In place** strips preview X/Z root travel only, retaining jumps and
source keys. Entering transform editing disables that preview treatment.

Upstream rationale, checked 2026-10-15: UniMate's own preprocessing describes
anatomical labels, facing review and motion-free skeleton pruning. This release
implements local JavaScript body-map suggestions, not the upstream Python/Blender
pipeline or its optional LLM annotation backend:
https://github.com/Friedrich-M/UniMate/blob/main/data_process/rig_preprocess/README.md
UniRig reference: https://github.com/VAST-AI-Research/UniRig

### Prompt editor and library

**Save & manage prompts** stores reusable prompt text, prompt name, generated action
name, duration and seed. Use **Save new**, **Update saved**, **Save a copy** or
**Delete saved**. Updating/deleting applies to the saved prompt actually loaded into
the editor; the starter prompts remain unchanged. Deleting a saved prompt retains
its current editor text. Duplicate names are rejected instead of overwriting another
recipe. The saved entries appear in their own dropdown group.

The current valid editor draft and up to **48 saved prompts** persist on this device,
independently of the asset database and even without saving a model draft. Prompt
text is limited to 2,000 characters. Incomplete/invalid numeric input keeps the last
valid persisted draft. Storage failures are visible and retain previous saved data.
Corrupt stored data is not silently replaced.

**Export library** downloads saved prompts and the current valid editor draft as
JSON. **Import library** merges saved entries, assigning separate names to conflicts;
it keeps the current editor draft and existing entries. Imports are validated and
bounded to 256 KiB. Use exports as portable backups. This prompt persistence does not
save unsaved mesh, rig, weight or animation edits.

### Model limits and motion fidelity

UniMate uses the pinned v3 checkpoint and Flan-T5-base encoder. Weights remain
**CC BY-NC 4.0** for non-commercial use under those terms. It accepts one connected
**5–70-joint** tree, Y-up and facing +Z, and outputs **30 FPS** motion. This adapter
normalizes the rest rig and translates anatomical joint labels into the vocabulary
used by the model. The first 60-frame window uses the official adaptive `dopri5`
solver. Longer requests use prior-tail-conditioned 50-step Euler continuation with
12 frames of overlap. The overlap is retained once and the full feature sequence
is decoded once, preserving continuous root motion and exact fractional end times.
Keeping an overlap once avoids duplicate frames; it is not a guarantee that pose
or velocity matches at every join. The Lab receives an already assembled motion,
not the original overlapping windows. See the
[0.15.1 segment audit](ACTION-PROMPT-UPDATE.md#segment-smoothing-check) for the
frontend checks and the runtime source still needed to inspect overlap blending.

Six seconds needs four neural windows; 60 seconds needs 38. CPU can take minutes
per window. Start with a short motion test.

The learned rotation channels describe incoming bone edges. They cannot be applied
directly as joint-local skinning rotations. The adapter reconstructs neural joint
positions, then derives outgoing-joint world deformation rotations for the editor.
Frontend retargeting preserves source rest conventions, initial root height and
exact joint-name matches before aliases. Axial twist cannot always be recovered
from joint positions. These are representation fixes, not a guarantee of realistic
running, stable contacts, correct balance, ordered multi-step prompts or suitability
for every human/animal rig. Preview the actual movement and the bound surface.

MoMask is a separate pretrained **HumanML3D humanoid** model, limited to
**0.5–9.6 seconds at native 20 FPS**. It generates learned joint positions, with
world deformation rotations derived for the editor. Anatomical target names are
required; animal and mechanical rigs are rejected. The final sample retains the
requested end time. Its pretrained checkpoints and HumanML3D-derived data have
upstream terms separate from UniMate; review the linked licence before download.

Model readiness is reported by the installed native runtime for the selected
model and device. A completed model load, matched joint count or browser fixture
is not proof of motion quality or Windows/RTX compatibility. Real CPU inference
and browser integration evidence are reported separately in verification. Model
weights are downloaded separately and are not included in the update archive.

**Import BVH motion** maps normalized joint names onto the current rig. Missing or
different names limit retargeting; inspect the result before saving. The recipe
contains rig/action data, while its matching GLB contains the mesh and skin weights.
Keep both for portable editing. Morph targets and animated scale are unsupported.
Imported object-transform animation is not converted into a mechanical rig.

## Reusable player and NPC movement

Open **Game preview** above the viewport, or **Game movement → Open movement
sandbox**. The model must have joints and at least one bound part. No AI model
needs to be loaded. The sandbox owns a separate render copy and never writes
preview positions, camera movement or aiming poses into the source action keys.

The settings panel assigns **Idle**, **Walk** and **Run** loops, plus optional
**Start moving**, **Come to rest**, **Walk backward**, **Strafe left** and **Strafe
right** clips. Suggestions use action names only; inspect each assignment. Trim
**From / To** to the useful section of each action. For walking and running,
include a complete stride rather than an arbitrary partial step. The ▶ button
previews an individual slot; a movement key or Reset returns to the controller.

**Movement feel** controls scale in preview metres, walking/running speeds,
acceleration, braking, turning rate, transition time and loop-seam smoothing.
The character starts reacting to input immediately and begins braking on release.
Start/stop clips are optional one-shots and can be interrupted. Without them,
poses blend between locomotion and idle. With no idle clip, stopping returns to
the rest pose, which can be a T-pose. Assign a relaxed idle for a useful character.

Horizontal root travel is removed on the preview copy so the controller owns
X/Z position. Vertical motion is retained. Root yaw is also removed by default
so the controller steers; the checkbox can retain it for experiments. Walk and
run share a normalized phase and blend by speed. Loop smoothing crossfades the
trimmed tail into the beginning; transitions crossfade poses. These operations
cannot solve badly timed strides or foot contacts. Tune speed to stride length
and inspect feet for sliding.

Choose **Face travel direction** for a character/animal that turns toward movement,
or **Face camera direction** for strafing/aiming. First person always uses the
latter. Missing directional clips fall back to the forward gait, so add separate
backward/side-step clips for convincing strafing. The **NPC test** repeats idle,
walk, run and stop inputs through the same controller. It is not pathfinding.

**Head & arms** maps optional head, chest and hand endpoints. Familiar joint names
are suggested; custom rigs need manual mapping. Looking applies limited additive
head/chest rotation over locomotion. Enabling hand aiming uses each hand's two
parent joints as an IK arm chain, with visible targets in third person. H toggles
aim; holding the right mouse button temporarily aims. Separate head/chest and arm influence sliders blend the result.
Locked/fixed joints are respected. Leave hand mapping empty for animals. This is
an aiming-pose test, not a weapon grip, elbow-pole or collision solver.

The first-person camera uses a stable mapped head/rest-height estimate slightly
forward of the mapped head, independently of animated head bob. A wider POV
field of view and near-head clipping keep the face out of the view without changing
source geometry. Third person is the
best view for checking arms and feet. Drag to look; **Capture mouse** optionally
uses pointer lock when the host supports it. Drag remains available if capture
is unavailable. The top-right bracket icon expands the sandbox to the window.

| Control | Sandbox action |
| --- | --- |
| W / A / S / D | Move forward / left / backward / right relative to view |
| Shift | Run |
| Q / E or left / right arrows | Turn the view |
| Up / down arrows | Look up / down |
| Drag / captured mouse | Look around |
| H / held right mouse | Toggle / temporarily hold arm aiming |
| V | Switch third person / first person |
| Space | Pause or resume |
| R | Reset position and controller |
| Escape | Release captured mouse, or close the dialog |

Movement keys require canvas focus. Typing, blur and hidden windows release held
input. Sandbox settings are experimental until **Keep settings** attaches them
to the working document as one undoable change. **Save actions** then keeps
them with the mesh, rig and original clips. Closing edited settings without
keeping asks before discarding. Saved pre-0.10 recipes remain supported. Removing
an action clears its slot; shortening an action clamps usable trim ends, and
removing a mapped joint clears the corresponding look mapping.

### Generate source clips and export game assets

**AI models → Start from a prompt → Game movement** offers start, come-to-rest,
backward and side-step prompts. Use Load prompt explicitly; changing suggestions
does not overwrite the editor. Existing idle/walk/run starters remain available.
The AI models produce fixed clips, not a guaranteed controller or ordered state
machine. Review/trim the result. If a start/stop prompt fails, omit that slot and
use the responsive transition blend. You can also import BVH or author poses.

- **Game clips GLB** makes a separate detailed model with the selected trimmed,
  in-place actions named by role. Loop smoothing is baked once, horizontal root
  travel is removed, and prompt/model provenance is retained in Action Lab
  metadata. The embedded movement profile points to these new clips and disables
  further seam smoothing. Head/hand look controls and runtime starts/stops are
  controller operations, not baked into every locomotion clip.
- **Movement recipe** exports `capp.movement-pack` v1 JSON with that same baked
  action document, role mappings, controller settings, source slot references and
  coordinate conventions. Keep it with the matching **Game clips GLB**. Names and
  keys agree between both exports. The original full actions remain in your
  Action Lab draft and normal animated GLB/recipe exports.
- A game engine must implement the controller settings and inputs; an ordinary
  GLB viewer just plays the clips. `src/action-movement.mjs` contains the tested
  controller/baking logic used by this sandbox. No Kestrel project or workspace
  is changed in this release.

Only a flat ground and grid are simulated. There is no collision, gravity,
foot-lock/contact correction, jump mechanic, navmesh or multiplayer prediction.
These are deliberate boundaries of the current movement test, not neural model
capabilities. Export limits continue to apply; shorten ranges or reduce assigned
slots if the baked-key budget is exceeded.

## Controls

Click the viewport to focus camera and editing keys. Text fields retain normal typing.
The top-right fullscreen button expands the workspace with timeline and side panels.
The **?** control shows the shared keyboard guide.

| Key | Action |
| --- | --- |
| W / A / S / D | Move camera forward / left / back / right |
| Q / E | Turn left / right |
| R / F | Move up / down |
| Arrow keys | Look around |
| Home | Fit model |
| 1–6 | Select / Joint / Move / Rotate / IK / Weights |
| Space | Play or pause |
| K / Shift+K | Key all joints / selected joint |
| [ / ] | Smaller / larger brush |
| Ctrl/Cmd+S | Save actions |
| Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl+Y | Undo; redo |
| Delete | Remove the selected joint after confirmation |
| Escape | Cancel the active gesture |

## Persistence and limits

The open Action Lab session survives workspace changes. Save explicitly before
reload or exit; there is an unsaved-work warning, but no reload autosave. Saved
drafts preserve the original asset and contain all clips atomically with the mesh.
Playback of saved actions needs no loaded AI model.

Limits: 128 joints, 512 mesh parts, 32 clips, 120 seconds per clip, 180,000 recipe
keys, 24 MiB recipes, 64 MiB GLBs and 540,000 baked animation channel keys at export.
Undo/Redo retains up to 16 states within 96 MiB. Large rigs/actions may need fewer
clips, shorter durations or a lower frame rate to export. These are bounded editing
tools, not a physics simulator or an automatic production-ready character pipeline.

See VERIFICATION-0.10.0.json for proxy, movement and browser checks.
VERIFICATION-0.9.0.json retains the asset-workflow evidence. VERIFICATION-0.8.0.json retains the prior model-integration evidence. VERIFICATION-0.6.0.json retains the earlier release evidence. Real CPU
inference validates execution, not representative motion quality on NPCs or animals.


## Game preparation · 0.13.0

Open **Game movement** and select an action on the timeline. **Keep action settings**
stores loop/one-shot playback, interruption policy, root travel policy and optional
metres per complete cycle. Movement-slot exports always bake in-place motion;
normal animated GLB export preserves authored source keys.

**Foot contacts** mark planted intervals. Click a coloured timeline band to seek;
rings show marked feet while this panel is open. Add, remove or suggest intervals.
Suggestions use sampled foot height and vertical speed and remain a proposal until
applied. They cannot determine correct anatomy or lock the foot. **Check this action**
reports large loop seams, root-only locomotion and drift during marked contacts.
Drift estimates assume straight motion (or a calibrated in-place stride); turning
and unusual quadruped gaits need visual review.

**Action events** add named timing markers such as left-foot-down, impact or
reload-click. They survive recipe/GLB persistence, reversal, trimming and movement
baking. The sandbox shows event crossings once. Kestrel queues presentation events;
there is no sound trigger adapter yet.

**Transfer action from another rig** accepts an Action Lab or movement recipe.
Review source → target body roles and tick the confirmation before adding the new
editable clip. Both rigs need valid body maps of the same type. World deformation
and authored facing are retargeted; target detail bones and weights stay unchanged.
The imported clip keeps provenance and marks its transfer source. Recalibrate stride
and inspect contacts, proportions and bends. Undo removes the transfer.

The sandbox includes optional crouch, prone/crawl, take-off, fall, land and left/right
turn slots. Its individual slot preview can inspect each; the flat sandbox controller
still tests idle/walk/run, directional starts/stops and head/arm look. Kestrel's actual
controller drives accepted posture, jump/fall/land and turning from gameplay state.
**Use measured stride speed** calibrates walk/run preview speed. Keep settings, then
Save actions, before copying to Project Assets. Kestrel publication requires
idle plus walk or run, one connected rig (1–128 joints), four weights per vertex,
ordinary supported PBR materials, and the same revision in Model and Movement.

## PNG and animated GIF capture · 0.13.0

The viewport's camera button exports a PNG at 768, 1024 or 2048 pixels on its longest
edge. Choose transparent, dark or white background and optional ground grid. The
capture contains the model and current display style, without editor panels/handles.

**GIF** exports a turntable in any 3D workspace, or the selected keyed action in
Action Lab. Choose start time, 0.5–30 seconds, 10/15/20 fps, 384/512/768 pixels,
repeat and optional in-place motion. Output is bounded to 80 million sampled pixels
and 64 MiB; larger captures ask for a shorter/smaller export. The progress preview
shows completed frames and Cancel exports no partial file. A cloned skeleton and
camera preserve the main viewport, playhead and unsaved edits. GIF has a fixed
256-colour dithered palette and hard transparency edges; PNG retains full colour/alpha.
No external service, AI engine, model preparation or new native dependency is used.

## Work packages and identity

See [creative suite](CREATIVE-SUITE.md) for durable work selection/notes,
revision saves, rename versus duplicate, and stale-save recovery.

Current [texture alignment and large-asset update](TEXTURE-ASSETS-UPDATE.md)
covers visual per-view alignment, visible previews and GLB admission.
