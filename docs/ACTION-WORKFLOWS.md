# Action Lab 0.15.1: equipment, reusable rigs and workflows

Start in **Action Lab** with an existing saved character. The new task tabs are **Rig shelf**, **Items & weapons**, and **Workflows**. Your existing drafts, GLBs, bones and skin weights remain in the same personal library. Saving creates a new draft.

## Equip a character

1. Open **Body map**, check the anatomical roles and facing, then **Use body map**.
2. Open **Items & weapons**, choose a type and **Add item**.
3. Enter its mass and the character's carrying limit. Under **Item size & linked asset**, set its dimensions in metres. The suggestion uses mass, size and weapon type to choose one or two hands. This is an authoring rule, not a strength simulation.
4. **Predict grips**, then **Make all four**, or make one action. The actual arm joints receive editable IK keys. Each item keeps its own equip, hold, use and holster clip assignments.
5. Play each action. Adjust the primary/support hand and body holster sockets if necessary. Add state markers at the playhead to change between held, holstered and hidden.
6. **Continue with UniMate / MoMask…** opens a tailored editable prompt in the existing AI panel. Generate a variation, review it, then bind the selected timeline action to the item.

Types: general carried items, pistol, rifle, sword, knife, axe/hammer, spear/staff, bow and shield. Weapon types have different local motion starters and preview shapes. These are starting animations, not finished performances. Reach warnings, body clearance and finger contact still require review. Generic equip actions do not locate arbitrary world objects or solve collisions.

The Lab shows lightweight item proxies. For an actual prop, enter its shared **project asset ID** in the item settings. Foundry resolves that asset's selected model, or a pinned revision when supplied in the recipe. Missing or skeletal prop models use a labelled proxy. Props are not baked into the exported character mesh. Detailed fingers and clothing hard points are future work; current sockets follow body bones.

## Reuse a rig and its actions

In **Rig shelf**, save the current character's rig and keyed actions with a name. Recipes can be exported/imported and are stored separately from model drafts.

For an unrigged NPC, choose a recipe and **Fit to this character**. Fitting preserves the recipe's bone IDs and hierarchy, fits uniformly to the target model height and grounds it to the model bounds. Inspect body proportions, review the body map and calculate fresh weights. Source skin weights are never copied to a different mesh. Replacing an existing rig requires the explicit replacement checkbox and is undoable.

For a character that already shares the same skeleton, reuse an action directly. Compatible rest frames can differ by uniform scale and translation. A different skeleton needs reviewed semantic body maps and uses retargeting. Speed and root-travel variations create new clips; the target's bones and weights stay unchanged. New proportions may need contact corrections.

## Run a workflow

**Workflows → Open workflow editor** opens a node canvas. Start with a preset, drag node headers, select a node to edit its settings, and use **Connections & position** to connect its output to the next step. Import/export JSON or save a named workflow on this device.

In a **Generate action batch** node, **+ Action** opens the same grouped starter
and saved-prompt list as the AI models panel. Choose a recipe, review its duration
and seed, then **Add selected action**. The clip name and description are copied
for you. Save personal recipes under **AI models → Save & manage prompts → Save
new**. The picker reads the live library each time it opens.

Use **Choose another action** to replace a row, or expand **Edit movement
description · optional** to customise its workflow copy. Replacing a row keeps its
Loop choice; newly added recipes start with Loop off because saved prompts do not
store that setting. Existing workflow JSON and automation calls still use complete
action objects. Saved/exported workflows remain runnable if their original prompt
is later changed or deleted. A MoMask selection longer than 9.6 seconds requires
you to reduce the duration before adding it; the saved prompt keeps its own value.

New **Apply joints & map body** nodes default to **Auto-detect body** and
**Auto-detect facing**. Choose explicit person/animal and facing settings when
needed; existing saved explicit choices are preserved. A paused node uses the
current Body map proposal, including manual corrections that match any explicit
node settings. Invalid or incomplete maps stop the run. The existing per-run
permission still controls automatic application; detection alone never accepts
the anatomical review.

Supported steps: current character; selected reference image; image-to-3D model; UniRig prediction; apply joints/body map; smooth weights; rig reuse; equipment actions; UniMate/MoMask motion batch; manual review; save draft. A batch produces multiple named motions for one character.

The editor runs one connected, typed sequence for one character at a time. Arbitrary branching, multi-character sheet queues and sheet cropping are not included. Choose the reference image in **Create** before running an image workflow. Existing image model availability and multiview requirements still apply.

At Run, select the exact model terms for this run. Imported/saved graphs cannot grant model consent. Optional run settings automatically apply valid predicted joints/body maps and calculate local weights. Otherwise those nodes pause. A **Manual review** node always pauses, even with automation enabled. Hide the editor, inspect the scene and return to Continue. Incomplete body mapping fails with a correction message. Weight calculation is distance-based local binding, not UniRig neural skinning.

The graph engine is deterministic orchestration, with no AI planner. Only generation nodes call installed local models. Runtime inference still needs the installed cApp provider and its checkpoints. UniMate's supplied checkpoint terms are non-commercial; inspect the linked terms for every model. Animation models can unload after a step. Image-model unloading is used only when exposed by the installed provider; otherwise the workflow reports that limitation.

Cancel retains completed scene edits and saved drafts. Retry starts at the failed node; completed motion clips are checkpointed and are not generated again. Review/failed runs remain attached to their character; switching character requires a new run. Save milestones before closing the app: run state and undo history are not persisted.

Example JSON workflows are in `docs/workflows/`. Model consent is intentionally absent from them.

## Send to Foundry

**Send to Foundry…** saves the current action draft, opens Project Assets and copies the revision when connected. Choose the target shared character and assign that revision to **Model** and **Movement**. The recipe, equipment settings, original mesh and actions travel together. An unconnected workspace asks you to connect before copying.

Foundry's **Equipment** tab lists the carrying rule, item actions and bone sockets. Play a bound action or override preview placement to inspect held/holstered states. State markers work when seeking and looping. Linked static project models are shown when available; otherwise an explicit proxy is used.

These changes author, retain and preview equipment. They do not add Kestrel runtime combat, pickup/inventory logic, weapon damage, collision or clothing hard points. No fresh Kestrel or cApp source was changed in this update. Native publication reports the equipment adapter limitation.

## Automation surface

`window.threeLab.actions` exposes `recipe`, `flow`, `getWorkflow()`, `setWorkflow(json)`, `runWorkflow(policy)`, `resumeWorkflow()`, `retryWorkflow()`, `cancelWorkflow()`, `openWorkflow()`, `listRigs()`, `getRig(id)`, `addEquipment(config)`, `save()` and `open(assetId)`.

A run policy has `acceptedModels: ['unirig','unimate']`, `autoApplyJoints` and `autoBindWeights`. It is supplied explicitly at run time and never imported from workflow JSON. Observe `actions.flow.status` and the node messages; a resolved run can be paused or failed and must not be treated as success. The recipe getter returns a detached normalized copy. Existing cApp provider permissions still apply.

Equipment config example: `{category:'carry',name:'Crate',massKg:8,dimensions:[0.45,0.35,0.35],hand:'auto',carryLimitKg:25,actions:['equip','hold','holster']}`. A reviewed humanoid body map is required. Public commands use the same bounded validation and editing operations as the UI.

## Updating

For the 0.15.1 prompt-picker update, apply only the supplied `3d-lab/` files to the
Lab folder from `3d-lab(9).zip`. The built HTML is included; existing project
identity, drafts and model installations are retained. See
[ACTION-PROMPT-UPDATE.md](ACTION-PROMPT-UPDATE.md) for the exact scope and segment
smoothing findings. This patch contains no Foundry or cApp source changes.
