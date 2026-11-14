# Shared project integration update

Use **Project Assets** for the new Kestrel registry/connector workflow:
[setup and limits](PROJECT-ASSETS.md). Rebuild this Lab using its existing identity.
No cApp host patch is included. The sections below document earlier AI/audio setup;
the new project connector is separate from those native capabilities.

# 3D Lab 0.10.0 integration

## Apply the 0.10.0 prediction and movement update

This release is built only from the newly supplied `3d-lab(8).zip`. It contains the
complete Lab source and rebuilt `index.html`. No cApp source, native engine or model
checkpoint changed, so this release needs no cApp overlay.

1. Copy this complete Lab folder into your existing **3D Lab source folder**.
   Keep the project/app identity so the same draft database remains available.
2. Freshly **Compile → Build Windows app**, then install that new release. Keep
   your existing Local AI 0.21.0 / MCP 0.24.20 package selection and animation grants.
3. Open **Action Lab → Choose asset**, or right-click a model in **Assets → Open
   in Action Lab**. Use **Import GLB** for a file on your device.
4. Follow **Your next step** to fit joints, attach geometry, animate and save. Saved
   action drafts reopen with their mesh, rig and clips. Changing models protects
   unsaved work with Save/Discard/Cancel.

5. Select UniRig and Generate skeleton on a dense mesh. Automatic preparation
   uses a local bundled Blob worker; no network script or native change is needed.
   In hosts with a restrictive CSP, worker-src must allow blob: for this app. A
   blocked worker fails visibly without replacing geometry or invoking inference.
6. Open Game preview, assign actions, test controls, then Keep settings and Save
   action draft. Game clips GLB and Movement recipe are matching portable exports.

Manual tools, asset selection and the movement sandbox work without loading a model. Existing AI engine
preparation remains unchanged. The validation for this interface update is in
`VERIFICATION-0.10.0.json`; Windows/WebView2 execution still needs target acceptance.

## Existing 0.8.0 native-model setup (already applied)

The following records the preceding model-integration release for reference. Its
cApp overlay is not part of this 0.10.0 Lab-only download.

### Previous 0.8.0 setup

The 0.8.0 release contained the complete `3d-lab/` source and a matching `capp-overlay/`.
The overlay is relative to the cApp root and is not a standalone cApp installation.
It targets the fresh `capp-v1(20261015-110947).zip` and `3d-lab(7).zip` supplied
for this phase. Do not apply it to an older source tree.

1. Copy `capp-overlay/` contents into that cApp source root, preserving the existing
   owner, project identities and data folders. Rebuild with
   `run-capp.ps1 -Clean -NoShowroomPublish`.
2. Copy `3d-lab/` contents into the existing **3D Lab source folder**, keeping its
   existing project/app identity. `index.html` is already rebuilt.
3. In the 3D Lab Windows package settings, use Local AI **0.21.0**, scoped application
   access, **Animation authoring**, and animation engines **UniMate + MoMask + UniRig** (`all`). Keep existing
   image-to-3D/speech selections if you use them. MCP is **0.24.20**.
4. Freshly **Compile**, then **Build Windows app** from the new release. The Windows
   build verifies pinned runtime dependencies and performs native import probes.
   Install the resulting app update. Packaging an old compiled release is insufficient.
5. In Action Lab, fit and bind the rig for motion, then choose **AI models**. Select
   UniMate (general named rigs, 0.5–60 seconds) or MoMask (humanoids, 0.5–9.6 seconds).
   Accept the selected model's linked terms and **Download & load**. Start with a
   short action and inspect the actual movement and deformation.
6. For skeleton prediction choose UniRig, or **Predict skeleton with UniRig** in
   Rig. No pre-existing rig is required. Review/edit the generated candidate, then
   apply unbound or explicitly apply with local smooth weights. Discard restores
   the prior rig/actions; apply is undoable. The model does not predict skin weights.

That update required both Lab and cApp: an older owner may still enforce the former
single-model limits or lack the new inference modules. The legacy `unimate`
selection remains UniMate-only; choose `all` to grant all three animation models.
The grant is still separate from 3D generation and speech.

UniMate now uses the official free-generation solver and prior-tail-conditioned
continuation, with canonical skeleton/name conditioning and corrected conversion
of learned edge rotations to joint deformation. Six seconds needs four windows and
60 seconds needs 38; CPU inference can be very slow. This does not guarantee stable
contacts or quality on every rig. MoMask keeps its native 20 FPS. UniRig sends a
bounded model-coordinate mesh, returns editable joints and requires review before
application. GPU is recommended; its CPU search profile uses one sampled sequence.

Old saved weights are preserved. To use the corrected automatic binder on an older
draft, choose **Rig → Binding scope → All mesh parts → Bind with smooth weights**,
review/paint the result, then save a new draft. This replaces weights only after
that explicit command and is undoable.
Prompt presets, editor drafts and saved prompt recipes are app-local and need no
model download. Export/import prompt libraries from **Save & manage prompts**.
This persistence is separate from saving a mesh/action draft.

Manual rigging/animation needs no model download. No weights are included in this
archive or the installer. Keep existing downloaded weights and draft databases.
Windows dependency execution, installed WebView2 and RTX 4070 inference require
acceptance on the target machine; only Linux CPU inference has been executed here.

Action Lab adds visible joint placement, weights, IK, mechanical hinges/sliders,
named actions and animated GLB saves. Shape Lab and Builder remain available with
their profile/outline modelling, point-snapped cuts, brushes and fullscreen tools.
Draft identity, original GLB bytes and generation detail limits remain intact.
Generating with **256 · Full** uses the same requested resolution; large outputs
are decoded without the former validation stack overflow.

Read [Builder](BUILDER.md), [Shape Lab](SHAPE-LAB.md) and [Action Lab](ACTION-LAB.md)
for workflows and limits. See `VERIFICATION-0.8.0.json` for the native-model update,
`VERIFICATION-0.6.0.json` for the first Action Lab release and
`VERIFICATION-0.2.1.json` for the earlier decoding fix. Context recovery retains
edits but cannot prevent GPU driver resets.

## Existing native-generation setup

1. Use the updated owner above. Local AI 0.21.0 retains the existing 3D generation engines and updates the separately scoped animation capability.
2. Replace the 3D Lab source with this complete folder, keeping the existing project/app identity so drafts remain accessible.
3. Select Local AI 0.21.0, scoped application access and **Scoped 3D generation**. Choose **TripoSR + TripoSG + Hunyuan shape models** to include all implemented engines. Scoped speech is optional.
4. Freshly **Compile**, then **Build Windows app** and run the installed app. Packaging an older release does not add the new inputs. The builder verifies dependencies and requires Windows native import probes. No model weights are in this ZIP or Setup.exe.
5. Choose a model. Requirements appear beside its name and below the selector. Accept that model’s linked licence and click **Download & load model**. Then generate a draft. Each model has a separate explicit download; model files can be several GB.

All nine model choices remain selectable on a 12 GB card. TripoSR supports CPU; the implemented advanced models require NVIDIA CUDA. Hunyuan outputs geometry in this release, including 2.1; its separate texture workflow is not included. For multiview, use the main input as front and add at least one matching left, right or back image. Saved drafts retain all references, the model, seed and steps.

Stable Fast 3D, SPAR3D and TRELLIS.2 are visible with memory, licence and setup information, but their runtimes are **not packaged yet**. Their prepare/generate actions remain unavailable instead of pretending to run another model. SF3D/SPAR3D config downloads require approved model access; TRELLIS.2 additionally requires a separately verified Windows dependency stack.

New TripoSR GLBs include smooth normals. Older GLBs get a preview repair; Clay and Flat compare geometry and shading without altering the saved model. Three-quarter images show more depth than side profiles. Single-view models still infer unseen surfaces.

The separate `capp.3d-lab.assets.v1` database and original GLB bytes are retained. No Voice Lab, Kestrel or SOL Explorer files are changed. Project production and full AI texturing remain later tools. Action Lab, Shape Lab, Builder and reference-image projection are active.

See `VERIFICATION-0.2.0.json` for the earlier image-to-3D engine evidence. Current `VERIFICATION.json` records the 0.9.0 asset-workflow phase. Browser/native fixtures are transport evidence; added GPU pipelines have not been benchmarked or run on the target Windows GPU here.
