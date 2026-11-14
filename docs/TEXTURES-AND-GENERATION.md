# Textures and reference framing · 3D Lab 0.21.1

This update uses the supplied 18 October sources only. It keeps the app identity,
shared disk catalogue, source drafts, rigging changes and mesh-count cap removal.
Local AI 0.23.0 / MCP 0.24.26 is needed for the new Hunyuan framing field.
Builder texturing itself needs no AI model or additional service.

## Surface textures and glass

Open a draft in Builder, select the relevant parts and choose **Texture**.
Upload PNG, JPEG or WEBP as base colour, normal, roughness or metalness. Use existing
UVs, **Box** for a generated mesh without UVs, or a planar direction. Repeat and
rotation are saved as standard texture transforms. Mapping changes UV0, so other
maps using UV0 also change alignment. Normal maps use OpenGL +Y; roughness reads
green and metalness reads blue, including greyscale maps. Colour images are sRGB;
data maps are linear. Inputs are limited to 25 MiB / 24 megapixels, decoded locally
and reduced to at most 2048 pixels per side. SVG and remote texture URLs are not inputs.

The inspector now offers matte, metal, clear glass and frosted glass presets plus
colour/tint, roughness, metalness, opacity, transmission, IOR and optical thickness.
Material changes preserve texture maps. Transmission forces opacity 1 and metalness
0; opacity is available for ordinary transparency when transmission is zero. Use
thickness 0 for a thin pane. Glass exports through glTF transmission, IOR and volume
extensions. A small local studio environment supplies preview reflections and is
not embedded in assets. Receiving applications need support for those extensions;
this update does not change Kestrel's renderer.

## Texture from the source image

1. In Builder's Texture panel, use the retained reference or choose a source image.
2. Match its direction to the model (front +Z, back −Z, left −X, right +X).
   **Use all saved views** uses the retained front and multiview inputs together.
   A newly selected source replaces the chosen direction for this bake.
3. Keep **Fit image foreground to model** on for alpha-cutout references. Opaque
   backgrounds cannot be separated automatically. Adjust scale, offsets or flip if
   needed. Use Align image visually… for a draggable preview and independent width/height. Each direction retains its own alignment.
4. Choose a 1024, 2048 or 4096 atlas and **Bake source textures**. Undo to compare,
   or Cancel during processing to retain the previous scene. Select multiple parts
   with Ctrl-click in the object list to texture them together.
5. **Save asset** writes a new revision on the same ID in the shared disk library. Original
   GLB/reference bytes and existing source views are retained. Export GLB embeds all
   texture images; it does not depend on browser files or external image paths.
   When a front reference exists, a replacement left/right/back source is saved in
   its matching slot. Otherwise the chosen source becomes the main reference;
   top/bottom are projection directions, not extra generation-reference slots.

This is orthographic projection with visible-surface selection and a baked UV atlas.
Every visible mesh participates in framing and occlusion, including unselected parts.
Only selected, visible, unlocked static parts receive texture. The algorithm chooses
the most directly facing supplied view after a 512-pixel depth test. It preserves
triangle positions, winding and count, adding vertices only at UV chart seams.
An unused UV channel preserves existing normal/roughness maps; repeat bakes reuse
their atlas channel only if unrelated maps do not use it. The atlas uses gutters and
keeps material groups compact. Unseen faces retain their current materials.

It is a practical first method for generated models and consistent character sheets,
not inverse rendering or a generative texture model. Source lighting is baked in;
perspective, mismatched views and occlusion boundaries can leave seams or distortion.
Visibility is tested at triangle centres, so large partially occluded triangles can
show projection bleed. Glass is treated as a solid occluder. Source alpha is sampled at face centres and inset corners; missing reference
areas keep their previous materials. This does not infer hidden artwork, remove
lighting, create PBR maps from one photo or straighten an already wavy mesh.

Existing image overlays remain available in a collapsed section. They create extra
triangles and must be removed before the new bake. Ordinary textures and the new
bake do not need overlays. Undo retains at most eight snapshots within its existing
96 MiB policy; texture pixel sizes now count toward that policy. At least the most
recent snapshot is kept, so a very large scene can exceed that target. The 64 MiB GLB budget is removed; format/memory bounds, eight embedded images and
32 million decoded pixels remain. See [the current update](TEXTURE-ASSETS-UPDATE.md).

## Hunyuan investigation and framing

The supplied coin's wavy tracks exist in its vertex positions, not just its normals.
The current worker does not smooth or decimate generated geometry. The pinned
Hunyuan multiview processor correctly routes front/left/back/right to 0/1/2/3 and
resizes each conditioning image to 512 pixels. Increasing extraction detail alone
cannot guarantee recovery of narrow, straight reference features.

**Reference padding** now offers Standard 15%, Tight 5% and Wide 25%. It controls the
upstream image processor's foreground margin, not octree resolution. Keep Standard
for the existing behavior; compare Tight using the same views, seed, steps and mesh
detail. Tight framing allocates more conditioning pixels to the object, but it also
changes the model input distribution. Its geometric benefit is unverified until a
real target-machine generation is inspected. No automatic sharpening, vertex cleanup,
model substitution or new inference dependency is introduced.

The child facade, owner, Rust admission and Python worker accept finite padding
0.05–0.25 for Hunyuan render only, defaulting to 0.15. Each render resets the cached
processor, so a previous Tight request cannot change a later legacy request. The
result confirms padding and reports processor size, cropped input dimensions/view
names, marching-cubes extraction and no geometry postprocessing. The Lab saves and
displays this metadata; Use reference and workflow nodes preserve the setting.
Unconfirmed results are rejected instead of saving a misleading recipe.

## Research and implementation choice

- [Hunyuan3D 2 paper](https://arxiv.org/html/2501.12202v1): shape reconstruction and
  texture synthesis are separate stages. The supplied runtime contains the shape
  pipeline; this phase does not claim to add the full neural paint model.
- The supplied pinned `hy3dgen/shapegen/preprocessors.py`, `pipelines.py` and surface
  extractor are the exact generation authority inspected here. They remain unchanged.
- [Three.js physical materials](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
  explain transmission, opacity, thickness and the value of environment reflections.
- [Three.js GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html) documents
  the portable material extensions. The implementation uses the already bundled
  Three 0.160.1 exporter, with no remote runtime dependency.

## Activation and evidence

Apply the combined overlay, rebuild/restart cApp, then freshly Compile and Package
the Lab with Local AI 0.23.0 and the existing Files/Links selections. Retain the app
identity, shared asset folder and verified model weights. Packing an old immutable
release does not pick up the runtime changes.

The verification record is [TEXTURES-AND-GENERATION-VERIFICATION.json](TEXTURES-AND-GENERATION-VERIFICATION.json).
Tests cover material/UV geometry, actual browser decoding and GLB export, Undo,
selection, disk reopening and controlled Hunyuan dispatch. Native compilation,
CTest, Windows/WebView2, CUDA inference, GPU quality/performance and Kestrel gameplay
acceptance remain unrun under the standing instruction.
