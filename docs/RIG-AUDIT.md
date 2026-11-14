# Rigging audit · supplied drafts · 18 October 2026

Reviewed 66 stored revisions across 47 asset IDs: 30 action recipes representing
22 rigged draft identities, 15 distinct detailed joint trees and 38 distinct GLB
payloads. The upload contains draft history without its active catalogue, so these
counts include stored revisions rather than asserting which entries are live.
Original draft files were inspected read-only.

## Findings and implemented changes

| Area | Finding | 0.19.1 behavior |
| --- | --- | --- |
| HOUND | Its low head failed the human head-above-pelvis rule. | The four-legged mapper follows the forward non-limb head branch and validates chest/head facing and Y-up paws. |
| HOUND forelegs | Short lateral collar links could become upper legs; distal paw tips could become the paw pivots. | Suggests upper joints 5/10, elbows 6/11 and paws 7/12. All collar/tip/detail joints remain present. |
| HOUND body | The original detailed tree has a wrapper root and no mapped tail. | Suggests pelvis 1, spine 2, chest 3, neck 14, head 15 and all four limbs: 17 roles, 7 retained extras. |
| Sweater cat | The low foot-height heuristic chose toe endpoints as feet and shifted the knee role. | New suggestions separate knees 27/31, ankles 28/32 and toes 29/33. |
| Porter bot | Large sloped boots put the ankles above the heuristic's preferred height band. | New suggestions use ankles 28/32 and toes 29/33. |
| Species/body type | The upright Husky and sweater cat have human-like anatomy. | They remain humanoids; asset titles/species names do not determine body type. |
| Tail/details | Distant tail or helper positions could distort body-scale validation tolerances. | Body-scale tolerances exclude quadruped tail/detail outliers. |
| Persistence | Re-normalizing already-unit rotations could change the last bits of saved animation keys. | Numerical unit rotations are retained exactly; non-unit/zero inputs retain normalization/validation. |

All 30 action recipes now have structurally complete proposals. Existing saved
maps remain valid and are never silently overwritten; the cat and porter receive
refined proposals only after Auto-detect is requested. Existing action keys are
not transferred to the new role IDs automatically.

## Data integrity

- All 66 stored model files match their asset hashes and byte lengths; they contain 38 distinct GLB payloads.
- Checked 1,419,551 skin-weight rows across 16 distinct skinned GLB payloads: no
  invalid/negative weights, bad sums, zero-weight rows or out-of-range bone indices.
- All 30 action recipes normalize successfully. One older “woman predictive joints” draft is unbound and still needs an explicit binding step before its surface can animate. Separate action JSON and embedded
  GLB documents agree within 1e-10 numerical tolerance; raw JSON differences were
  quaternion rounding, not missing rigs/actions.
- Rest joints lie within the mesh bounds at a 2% extent tolerance. This checks
  bounds, not whether each pivot is anatomically placed inside the surface.
- Real HOUND browser export tests compare vertex, skin-index and skin-weight
  buffer-view bytes before/after applying labels. Rest joints, bindings, source
  provenance and existing clips remain unchanged. Save/reopen uses a real disk
  catalogue in a fresh browser profile.

These checks establish valid stored data and non-destructive editing. They do not
establish skin deformation quality, foot contact, motion realism or actual GPU
inference. Review the surface with local bend tests and scrub representative clips.

## Follow-up in the app

1. Install the Lab source update using the included backup updater and freshly
   Compile/Package the existing cApp app from index.html. Retain its identity,
   Files/Links/Local AI settings, shared asset folders and current weights. This
   feature needs no cApp owner/runtime update.
2. Open HOUND's existing action draft -> **Body map -> Auto-detect body & facing**.
   Review the points and facing -> tick the review checkbox -> **Use body map**.
   Binding is already present; mapping itself does not require replacing it.
3. For the sweater cat and porter, request Auto-detect to inspect the new ankle/toe
   (and cat knee) proposals. Existing saved maps remain active until Use body map.
   Scrub the existing actions, then save a new action draft after deciding.
4. A few older drafts have duplicate names: the sweater cat has three Run forward
   and two Walk forward clips; woman 1 running has three Run forward clips and
   woman 1 running fixed has four. Give chosen variants distinct names before
   assigning movement in Foundry. Existing clip IDs/data are retained.

## Rig inventory

One representative stored revision per asset ID is shown here. The machine-readable
verification includes every action revision; no active catalogue was supplied.

| Draft identity | Joints | Proposed body / roles | Saved map |
| --- | ---: | --- | --- |
| Bastion actions | 34 | Human / 21 | Human, 21 roles |
| Front view cat in a brown sweater 1 actions | 34 | Human / 21 | Human, 19 roles |
| guard actions | 34 | Human / 21 | Human, 21 roles |
| HOUND MK2 FRONT 1024x1024 actions | 24 | Four-legged / 17 | None |
| Husky actions | 40 | Human / 21 | Human, 21 roles |
| Husky actions (2) | 40 | Human / 21 | Human, 21 roles |
| Man 1 actions | 34 | Human / 21 | Human, 21 roles |
| porter service bot (2) actions | 34 | Human / 21 | Human, 19 roles |
| Practice humanoid | 22 | Human / 21 | Human, 21 roles |
| Practice humanoid (2) | 22 | Human / 21 | Human, 21 roles |
| Practice humanoid (3) | 21 | Human / 21 | None |
| ranger actions | 34 | Human / 21 | Human, 21 roles |
| ranger actions (2) | 34 | Human / 21 | Human, 21 roles |
| woman 1 actions | 34 | Human / 21 | Human, 21 roles |
| woman 1 actions (2) | 34 | Human / 21 | Human, 21 roles |
| woman 1 running | 21 | Human / 21 | None |
| woman 1 running fixed | 21 | Human / 21 | None |
| woman predictive joints | 34 | Human / 21 | None |
| woman predictive joints (2) | 34 | Human / 21 | None |
| woman predictive joints (3) | 34 | Human / 21 | None |
| woman predictive joints walking | 34 | Human / 21 | Human, 21 roles |
| woman predictive joints walking (2) | 34 | Human / 21 | Human, 21 roles |

## Evidence and remaining acceptance

See [verification](RIG-AUDIT-VERIFICATION.json). The Node suite includes the supplied
15 joint trees, four horizontal facings of the real HOUND, collar/toe handling,
inverted poses, long tails, horizontal upper legs, wrapper-root travel and exact
rotation persistence. Browser checks use actual HOUND, Husky, sweater cat and porter
GLBs alongside controlled synthetic animation replies in the existing regression.

No model inference, native compile/build, CTest, installed Windows/CUDA execution,
VRAM/performance benchmark or Kestrel gameplay acceptance was performed under the
standing instruction. No original draft, model weight, cApp/Foundry/Voice/Kestrel
source or shared asset catalogue is modified by this source overlay.
