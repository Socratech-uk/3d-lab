# Hunyuan detail and memory · 3D Lab 0.20.0

This phase uses only the two supplied 18 October source archives. cApp Local AI
0.23.0 / MCP 0.24.26 and this Lab must be updated together.

## Controls

Hunyuan 2 mini, 2, multiview and 2.1 offer 128, 256, 384 and 512 mesh detail.
TripoSR and TripoSG retain 128/256; unavailable model runtimes retain their setup
messages. This is geometry sampling resolution, not an image or texture size.

| Control | Range / default | Effect |
| --- | --- | --- |
| Steps | 10–75 / 30 | Denoising iterations; 50/75 were already supported. |
| Reference padding | 5%, 15% or 25% / 15% | Hunyuan foreground framing; compare with the same seed. Tighter is not guaranteed better. |
| Seed | 0–2147483647 / 0 | Reuse to compare references and settings. |
| Guidance | Finite 0–20 / 5 | Reference conditioning strength; more is not always better. |
| Decode batch | Integer 1000–32000 / 8000 | Points decoded together; smaller batches can lower part of peak memory use. |
| Model memory | GPU / GPU | Retain the pipeline on GPU for speed. |
| Model memory | CPU offload | Load on CPU, stage components on NVIDIA GPU and offload after the operation; uses system RAM and can be slower. |

CPU offload still needs CUDA. It is not a CPU-only Hunyuan engine. It applies to
Download & load as well as Generate, avoiding a full GPU allocation before enabling
offload. Changing memory mode reloads the pipeline from the same verified weights.
There is no automatic resolution reduction, model substitution or OOM retry. The
64 MiB GLB limit remains; fixed vertex and triangle ceilings were removed in 0.19.2.

## Saved generations

The engine returns its applied resolution, seed, steps, guidance, batch size,
memory mode and reference padding. It also reports bounded conditioning metadata. The Lab verifies them and saves the normalized recipe with each disk
asset. The inspector displays the values. Assets → right-click → Use reference
restores all generation controls and the original multiview images, retaining the
original draft. Workflow Generate 3D model nodes save the same options. Old recipes
remain readable with their original 256/default behavior; no old mesh is rewritten.

## Activate

1. Apply both source overlays and rebuild/restart cApp using
   `run-capp.ps1 -NoShowroomPublish`.
2. Update the existing 3D Lab project from this `index.html`. Keep the app identity,
   Files and Links settings. In Local AI retain Scoped 3D generation and select
   TripoSR + advanced shape models. Freshly Compile, then Package and install as an
   update. The package must carry Local AI 0.23.0.
3. Prepare the selected model explicitly if needed. Existing verified Hunyuan
   weights, pinned revisions and dependency archives are reused. Source changes
   still require the packaged engine to be rebuilt; do not clear model caches.

Voice Lab, Foundry and Kestrel source do not need updating for this phase. An app
that wants the new Hunyuan API must package the updated Local AI runtime.

See [the framing investigation and texture method](TEXTURES-AND-GENERATION.md).

## Evidence and limits

Core and workflow tests, both real JS facades, Python PNG admission and worker
dispatch tests, generated Windows scaffolds, immutable owner-service closure and
the built-browser/disk workflow are checked. The browser test generates a synthetic
GLB through controlled IPC; it does not perform neural inference. An empty browser
profile reopens the disk draft and restores every control before a new variation.

No native compile/build, CTest, installed Windows run, real CUDA generation,
VRAM/performance benchmark or gameplay acceptance was performed under the standing
instruction. Actual 384/512 quality and memory use must be reviewed on the target
machine. A passing source/fixture check is not GPU qualification.
