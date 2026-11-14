# Permanent asset storage · 3D Lab 0.16.0

3D Lab now saves its draft library to ordinary files in:

`C:\Users\alex1\cApp\assets\3d`

The default is `%USERPROFILE%\cApp\assets\3d`, so the folder follows the Windows
account. This location is independent of the Lab source folder, installer and
browser profile. The browser database remains a cache and a migration source.

## Apply this update and migrate

1. Apply the changed-files update to the same 3D Lab source folder. Do not replace
   the whole repository. The supplied updater verifies source hashes and backs up
   the replaced files. A rebuilt `index.html` is included.
2. Freshly Compile and Package the Lab under its existing app identity, then
   install the update. Keep the existing app/browser data until migration finishes.
   There is no cApp owner or AI engine source update in this package.
3. Run `Start-3D-Asset-Storage.cmd` in the updated source folder. Python 3 is the
   only requirement; no packages or model downloads are installed. It creates the
   asset folder and prints a private connection link. Keep the window running.
4. Open the **existing installed Lab** which holds your drafts. Click **Asset
   storage**, paste the printed link and choose **Connect & migrate**. The link is
   distinct from a Foundry project connection. Both connections can stay active.
5. Wait for the migration summary. It reports any failed draft individually; retry
   after correcting the cause. Successfully copied drafts are not duplicated.
   Future launches remember the connection; start the storage service after a
   Windows restart. Future draft saves write to disk before showing success.

Migration runs on your machine when the updated app connects. A source ZIP does
not contain that app's browser database, so packaging this update cannot migrate
those records remotely. If you previously saved drafts in more than one browser
or Lab installation/origin, connect each of those original instances once.
Opening a new browser does not give it access to another app's old browser data.

## What is saved

- Generated, imported, Builder, Shape Lab and Action Lab drafts.
- Original GLB data, including embedded geometry, materials, rigs, weights and
  animations, plus editable action/shape JSON where present.
- Asset IDs, names, folders, tags, notes, project links and generation metadata.
- Original front/left/right/back references and thumbnails where present.
- Saved motion prompts and their valid editor draft, saved workflows, reusable rig
  recipes, and Shape Lab's existing editable session snapshot.

An unsaved Action Lab or Builder editing session still needs **Save draft**.
Workflow plans still need **Save workflow**. Generation and workflow save nodes
use the same disk-first draft library. This change does not autosave incomplete
editing gestures, undo histories, licence decisions or native model state.

## Ordinary files and other tools

`catalogue.json` is the authoritative list of active drafts. It contains metadata
and a fingerprint for each committed revision. A draft's files are in
`drafts/<asset-id>/<fingerprint>/`:

| File | Contents |
| --- | --- |
| `model.glb` | Complete self-contained model, with any embedded rig/animations |
| `asset.json` | Human-readable asset metadata and provenance |
| `action.json` | Editable Action Lab document, when supplied |
| `shape.json` | Editable Shape Lab document, when supplied |
| `reference.*`, `reference-left.*`, etc. | Preserved original images |
| `thumbnail.png` | Optional preview |
| `record.json` | Checksummed bundle descriptor used by the catalogue |

Open a draft in the inspector and use **Copy disk model path** to use its GLB in
another tool. **Project Assets** and **Send to Foundry** continue to read this same
library, so no manual re-import is needed for those handoffs. The permanent folder
is an authoring library; saving there does not automatically publish into Kestrel.

`settings/` holds `action-prompts.json`, `workflows.json`, `shape-session.json` and
`rig-shelf.json`. Files are created when there is content to preserve. The rig shelf
is an array of rig recipes; individual recipes can still be exported in the UI.
`recovered/` keeps conflicting browser authoring collections for manual import.
`_history/` retains prior catalogues/settings; removed drafts retain their disk files.
`_blobs/` holds verified content; `_service/` holds the connection token and writer
lock. Keep these folders with the catalogue when backing up the asset library.
Do not edit the catalogue or committed snapshot files in place; import external
edits and save a new revision. No automated pruning or destructive cleanup is added.

## Failure and recovery behaviour

A model save uploads and verifies every content hash, writes the complete revision,
then atomically commits its catalogue entry. An incomplete write cannot replace a
previous catalogue entry. Browser cache failure cannot cancel an acknowledged disk
save. If the service is stopped or disk writing fails, the UI reports that the work
is not saved to disk and retains the current model/recipe for retry or export.

Migration keeps original IDs and bytes, marks each verified cache record, and leaves
browser copies in place. A different legacy record using the same ID is recovered
under a separate deterministic ID. Disk deletions are tombstoned so stale browser
copies cannot resurrect them. Metadata uses expected revisions; concurrent saved
collections use expected fingerprints. Conflicts preserve both copies rather than
silently overwriting disk data. Cache loss does not remove disk assets.

The service binds only to `127.0.0.1`, checks its Host header and requires a random
persisted bearer token. Only its asset folder and fixed operation names are exposed;
there is no arbitrary filesystem, command execution or AI inference API. Use the
existing host's networking permissions; no raw native IPC or permission bypass is
introduced. Do not share the private connection link.

Optional override for another account or drive:

```powershell
py -3 .\tools\asset_storage.py --root "D:\cApp-assets\3d"
```

A second writer for the same folder is rejected. If port 43193 is occupied by
another service, add `--port 43194` and connect using that service's printed link.

Current [texture alignment and large-asset update](TEXTURE-ASSETS-UPDATE.md)
covers visual per-view alignment, visible previews and GLB admission.
