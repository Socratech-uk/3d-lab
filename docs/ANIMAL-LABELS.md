# Supplied-draft refinements · 0.19.1

See [the real draft audit](RIG-AUDIT.md). HOUND's head can be below its pelvis;
quadruped head suggestions follow the forward non-limb branch. Short collar links
and paw tips remain detail joints. Upright anthropomorphic animals keep the
humanoid schema, with improved ankle/toe hints for large feet and short legs.
Saved maps remain unchanged until **Auto-detect body & facing → review → Use
body map → Save action draft**. Source bones, weights and clips are retained.
The original 0.19.0 notes below describe the initial synthetic-fixture release.

# Animal body labels · 3D Lab 0.19.0

Action Lab now suggests the body category and horizontal facing for common
four-legged rigs, including generic `Joint0…` predictions. It examines the joint
tree and rest positions, rather than guessing from the asset title or joint count.
The existing Hunyuan 0.18.0 controls and disk storage are retained.

## Use an existing animal rig

1. Open its action draft or rigged GLB in Action Lab. No new prediction is needed.
2. Open **Body map**. An unmapped four-legged layout gets animal suggestions;
   **Auto-detect body & facing** refreshes them after manual edits.
3. Check the highlighted pelvis, spine/chest, neck/head, four leg chains, paws and
   optional tail. Choose a role to show its point. Correct selections and the
   forward direction as needed, then tick the review checkbox and **Use body map**.
4. Preview existing actions or a local bend test. **Save action draft** keeps the
   body map with the full rig in the existing shared disk catalogue.

The rig list shows `LeftFrontFoot · Joint15`-style aliases and accepts searches
such as `FrontFoot` or `Tail`. Unaccepted proposals say **suggested**. The Joint
panel shows the body label separately from its original editable name, and parent
choices use the same labels. Unmapped detail joints keep their source names.

After a new UniRig prediction, the body panel opens automatically with unreviewed
suggestions. Review and **Use body map**, then **Apply skeleton** or **Apply &
smooth-bind locally**. Applying a prediction retains its existing replacement
semantics: the prior rig/actions are held until Apply, Discard restores them, and
one Undo after Apply restores the previous scene. Applying body labels to an
existing rig does not run binding or replace its actions.

## What changes

The body map references stable source joint IDs. It never renames/reorders bones,
changes parentage/rest positions, rewrites skin indices, replaces painted weights
or alters existing action keys. Up to 19 semantic animal roles condition UniMate;
all other bones stay in the detailed mesh rig and follow their parents. Labels
persist in Action Lab recipes and embedded GLB metadata. Standalone GLB bone names
retain the existing source/editor naming conventions.

The detector tries +Z, -Z, +X and -X. It needs four low limb branches, separate
front/rear paw rows, valid ancestry and a forward pelvis-to-chest direction before
claiming a detected quadruped. Long or low centreline tails do not determine the
front/back paw split. Named anatomy takes precedence. Tail candidates are kept
separate from spine/limb paths. Two-legged people keep the humanoid path.

These are deterministic suggestions, not verified animal recognition. Rigs rooted
at an incompatible torso branch, missing limbs, crossed/atypical poses, uncertain
head/tail detail, non-Y-up rigs or animals with other limb counts need manual work.
Body type and facing can always be chosen explicitly. Detection does not accept
the review checkbox or authorize motion generation. Rest/hierarchy changes make
an accepted review stale; Undo/Redo restores the mapping and review state.

Use **UniMate** for animal text motion. MoMask remains humanoid-only. A correct
body map improves conditioning but does not establish gait/contact quality.

## Workflows and activation

New **Apply joints & map body** nodes use automatic body/facing settings. Saved
explicit person/animal/facing settings keep their meaning. During a pause, the
node uses compatible editor corrections; incomplete/invalid maps stop the run.
Existing per-run automatic-application permission and mandatory review gates remain.

This is a **3D Lab-only source update** on top of the supplied 0.18.0 source.
Apply the overlay, update the existing cApp app from its rebuilt `index.html`,
retain its app identity and Files/Links/Local AI settings, then freshly Compile,
Package and install. This feature requires no cApp owner/runtime update or new
model weights. Keep the prior Hunyuan Local AI 0.22.0 runtime if using those controls.

See [verification](ANIMAL-LABELS-VERIFICATION.json). Checks use synthetic 24-joint
and helper-rich fixtures, controlled model replies, real GLB exports and a real
temporary disk store. The actual HOUND asset was not supplied. No native build,
CTest, installed Windows/CUDA, real model inference or gameplay/performance
acceptance was run under the standing instruction.
