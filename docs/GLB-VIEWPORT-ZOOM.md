# GLB export, workspace sizing and page zoom · 0.20.1

This repair uses only `3d-lab(20261018-151810).zip` (SHA256
`58ee5f980b99b754ae95c99bf4ff5b1fa2271e50edbced44cacb9201a7e6b82a`)
and `capp-v1(20261018-161738).zip` (SHA256
`2cd73ab0aae01daba1966cddd0c91cc351f117ee524ecf2a5f8d53ad6d692275`).
It retains source identity, drafts, rigs, textures, shared Files storage, model pins
and the removal of global mesh-count ceilings.

## Invalid GLB metadata after denoising

The exact pinned Trimesh 4.0.5 exporter reproduces the reported error when a mesh
contains a zero-length vertex normal. Its default normalization divides that vector
by zero, creating NaN in the NORMAL binary data and accessor JSON bounds. Strict
JavaScript JSON parsing then raises `Invalid GLB metadata.`. The failed user output
itself was not supplied; this is a verified exporter failure matching that symptom.

Local AI 0.23.1 repairs shading normals before advanced-model export. Valid normals
are normalized; undefined normals use the first valid adjacent face. Isolated or
wholly degenerate vertices use a deterministic Y-up normal. It then disables the
exporter's duplicate normalization and checks strict JSON before returning the GLB.
Vertices, faces, winding and triangle counts are unchanged. This does not repair
non-manifold topology or improve the generated shape. The result reports bounded
`normalRepair` counts. No exporter dependency or vendor source was replaced.

If another completed result fails GLB validation, the Lab now retains its exact
decoded bytes while the app remains open. **Download GLB** keeps those original
bytes available for recovery; invalid data cannot enter the draft catalogue.
**Discard result** requires confirmation before another generation. Storage failures
for valid results still allow **Retry save**. Retention is temporary recovery, not
a disk-save claim: download before closing the app.

## Workspace layout

At widths of at least 1000 CSS pixels, Create, Builder, Shape Lab and Action Lab
occupy the available height between the app header and footer. Tool/inspector
panels scroll independently. A long multiview generation form cannot stretch the
viewport below the window. The action timeline has its own scroll area; source and
tool chrome are compact. Shape split view keeps sketch and preview side by side.
Existing fullscreen behavior remains available.

Below that width, Create places the complete preview before the stacked form and
inspector. The document may scroll so every setting remains reachable. The shared
`workspace-layout.css` is built last; workspace routing updates `body[data-view]`.
Renderer ResizeObservers resize the canvas after layout changes.

## Ctrl+scroll

MCP 0.24.27 enables Tauri's `zoomHotkeysEnabled` by default for generated Windows
main WebViews. Links 0.6.0-alpha.2 enables the corresponding native setting on its
Windows child tabs. WebView2 owns Ctrl+wheel and browser keyboard page zoom; no new
application IPC grant or CSS-transform emulation is introduced. This phase leaves
Android, Linux and macOS zoom behavior unchanged.

The Lab's 3D canvas leaves Ctrl/Cmd+wheel uncancelled before OrbitControls sees it;
the sketch canvas also leaves it alone. Ordinary wheel gestures continue to zoom
the model or sketch. The native setting requires a rebuilt Windows package; updating
the HTML alone cannot enable a disabled native zoom setting.

## Activate and verify

Apply the combined overlay to both source checkouts. Rebuild/restart the cApp owner
with publication suppressed, retain the Lab's app identity and Files/Links settings,
then freshly Compile and Package the Lab with Local AI 0.23.1. Existing Hunyuan weights
are reused. Old immutable releases remain unchanged.

See [the verification record](GLB-VIEWPORT-ZOOM-VERIFICATION.json). Tests include the
exact pinned exporter, invalid-result recovery, real facades/Files worker, valid
generation save/reopen, fitted desktop/laptop/mobile layouts, canvas gesture routing
and generated Windows source. Browser generation replies are controlled outputs;
they do not run the Hunyuan checkpoint. No native compilation, CTest, installed
Windows/WebView2 run, native zoom interaction, CUDA inference or gameplay/performance
acceptance is claimed under the standing instruction.
