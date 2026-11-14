# Mesh counts · 3D Lab 0.19.2

The fixed vertex and triangle-count ceilings are removed from generation, GLB
inspection/import, Builder scene/component editing and automatic rig preparation's
source mesh. No new higher count ceiling replaces them. The generated model is
not silently reduced to fit a preview budget.

Local AI 0.22.1 removes the matching completed-output checks for Hunyuan, TripoSG
and TripoSR. Invalid/empty outputs still fail; non-finite advanced-model vertices
remain invalid. Buffer bounds, self-contained GLB rules, texture/rig/action format
validation and the existing 64 MiB GLB transport/storage bound remain.

Individual algorithms retain their own bounds: cuts/shells/island separation have
350,000-source-triangle inputs, outline fragmentation has its existing output
bound, and UniRig receives a temporary copy within 20,000 vertices / 40,000
triangles. The original detailed mesh, weights, joints and actions are retained.
Procedural Shape Lab authoring and Undo memory budgets are separate.

## Activation

Apply both project roots from the supplied overlay using its hash-checked updater.
Rebuild and restart the cApp owner with `run-capp.ps1 -Clean -NoShowroomPublish`.
Freshly Compile this Lab with Local AI 0.22.1, retaining app identity and existing
Files/Links/Local AI configuration, then Package and install the new release.
An HTML-only update cannot replace an installed generation worker.

Existing shared drafts, model files, pinned weights and Hunyuan controls are reused.
Validation evidence is in the matching cApp repair record. Browser/source checks
do not establish neural quality, installed Windows/CUDA or performance acceptance.
