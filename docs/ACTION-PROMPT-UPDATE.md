# 0.15.1 · workflow action picker

## What changed

- **+ Action** opens the Action Lab starter and saved-prompt catalogue instead of
  creating a generic text-entry row.
- Selecting a recipe fills in the clip name, description, duration and seed.
  Review the settings, then click **Add selected action**.
- **Choose another action** replaces an existing row and retains its Loop choice.
  New selections start with Loop off; prompt recipes do not contain a Loop setting.
- Manual description editing is tucked into an optional section. Each workflow
  keeps a portable snapshot, so editing the row or deleting its saved source does
  not affect the other copy.
- Saved prompts created or updated in the current Action Lab session appear when
  the picker opens. MoMask rejects durations above 9.6 seconds until you explicitly
  shorten the workflow copy. UniMate retains durations up to 60 seconds.
- The picker and replacement controls lock during an active workflow. The action
  limit is enforced, and adding a row opens that row for review.

This uses **prompt recipes**, including the exact grouped catalogue shown in the
screenshot. Reusing already generated animation keys remains **Rig shelf** work.

## Install this changed-files update

The baseline is the supplied `3d-lab(9).zip` (Lab 0.15.0), SHA-256:
`a267a77e7604d70ca67ad8e8e9ad68163c0f72cce13e4572f0194d961892d8cb`.

Close the Lab, back up the files listed in the patch manifest, then merge the
contents of the patch's `3d-lab/` folder into the existing Lab folder. Replace only
matching files and add the new ones. Keep the remaining files and browser data.
Do not replace the whole repository or clear saved drafts.

The prebuilt `index.html` is included. A standalone browser copy can use it
immediately. An installed cApp app needs its normal repackaging process to pick up
the updated HTML. If Foundry serves its bundled Lab, that bundle also needs this
updated HTML through your usual embedding/package step; this update does not
patch an older Foundry archive. The connection link is not a code-update mechanism.

## Segment-smoothing check

The supplied Lab source calls `ActionEngine.generate()` and receives a completed
`capp.motion.v1` sequence from cApp. `retargetMotion()` maps that sequence onto the
character. `sampleClip()` linearly interpolates positions and uses quaternion
SLERP for rotations between keys. It does not receive or blend the original neural
overlap windows. The game sandbox's loop blend is a separate end-to-start operation.

The existing runtime documentation describes 60-frame UniMate windows at 30 FPS
with 12-frame overlaps and 48-frame advances. New focused regression checks cover
both sides of those overlap-sized intervals. A continuous synthetic source remains
continuous through retargeting, save/reopen and playback, including alternating
quaternion signs and an exact fractional end time. A synthetic jump supplied by
the generator remains in the editable keys: interpolation alone does not remove it.

**No neural segment-blending fix is claimed or applied in this patch.** The cApp
runtime source and a generated motion exhibiting the hitch are needed to inspect
how overlaps are retained, aligned and blended, and to assess pose/velocity and
foot-contact continuity. This Lab ZIP has no implementation of that stitching.
Applying a guessed smoothing filter would also risk changing intentional stops,
impacts and planted feet without diagnosing the underlying seam.

## Verification

The source tests cover catalogue sharing, immutable recipe snapshots, portable
workflow export, model duration limits and frontend motion continuity. The browser
test exercises the built HTML with real UI, storage and workflow execution, using
controlled model replies. It verifies the exact prompt, duration and seed reaching
the adapter, live library updates, source deletion, reload, model-limit feedback,
run locks and the phone layout. These controlled replies are not neural inference.

No native build, CTest, Windows execution or real model generation was performed.
See `ACTION-PROMPT-VERIFICATION.json` for the final results and built HTML hash.
