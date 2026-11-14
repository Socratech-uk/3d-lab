// Catalogue supplied with Local AI 0.22. Hardware does not filter choices.
export const MODELS = Object.freeze([
  {
    "id": "triposr",
    "name": "TripoSR",
    "minimum": "6 GB VRAM \u00b7 CPU also supported",
    "description": "Fast draft mesh with vertex colours.",
    "engine": "models3d",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/stabilityai/TripoSR/blob/main/LICENSE",
    "devices": [
      "auto",
      "cuda",
      "cpu"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256
    ],
    "sourceUrl": "https://github.com/VAST-AI-Research/TripoSR"
  },
  {
    "id": "triposg",
    "name": "TripoSG",
    "minimum": "8 GB VRAM \u00b7 NVIDIA",
    "description": "Higher-detail geometry; untextured mesh. Slower than TripoSR.",
    "engine": "models3d-advanced",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/VAST-AI/TripoSG",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256
    ],
    "sourceUrl": "https://github.com/VAST-AI-Research/TripoSG",
    "downloadBytes": 7946491209,
    "runtimeReady": true
  },
  {
    "id": "sf3d",
    "name": "Stable Fast 3D",
    "minimum": "6 GB VRAM \u00b7 NVIDIA",
    "description": "UV-mapped mesh and materials. Requires an approved Stability model download.",
    "engine": "models3d-unpackaged",
    "license": "Stability AI Community",
    "licenseUrl": "https://huggingface.co/stabilityai/stable-fast-3d/blob/main/LICENSE.md",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256
    ],
    "sourceUrl": "https://github.com/Stability-AI/stable-fast-3d",
    "setupReason": "Setup pending: the gated model configuration and native UV/texture components are not packaged in this release.",
    "downloadBytes": 0,
    "runtimeReady": false
  },
  {
    "id": "spar3d",
    "name": "SPAR3D",
    "minimum": "7 GB low-VRAM / 10.5 GB standard \u00b7 NVIDIA",
    "description": "Point-conditioned reconstruction with textures. Low-VRAM mode trades speed for memory.",
    "engine": "models3d-unpackaged",
    "license": "Stability AI Community",
    "licenseUrl": "https://huggingface.co/stabilityai/stable-point-aware-3d/blob/main/LICENSE.md",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256
    ],
    "sourceUrl": "https://github.com/Stability-AI/stable-point-aware-3d",
    "setupReason": "Setup pending: the gated model configuration and native UV/texture components are not packaged in this release.",
    "downloadBytes": 0,
    "runtimeReady": false
  },
  {
    "id": "hunyuan3d-2mini",
    "name": "Hunyuan3D 2 mini",
    "minimum": "5 GB VRAM \u00b7 NVIDIA",
    "description": "Geometry generation; no texture stage in this release.",
    "engine": "models3d-advanced",
    "license": "Tencent Hunyuan 3D 2 Community",
    "licenseUrl": "https://huggingface.co/tencent/Hunyuan3D-2mini/blob/f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6/LICENSE",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256,
      384,
      512
    ],
    "sourceUrl": "https://github.com/Tencent-Hunyuan/Hunyuan3D-2",
    "downloadBytes": 3819959862,
    "runtimeReady": true,
    "licenseNotice": "Tencent\u2019s licence excludes use in the UK, EU and South Korea. Confirm that your use and distribution meet its terms; publication location alone does not decide this."
  },
  {
    "id": "hunyuan3d-2",
    "name": "Hunyuan3D 2",
    "minimum": "6 GB VRAM \u00b7 NVIDIA",
    "description": "Geometry generation; no texture stage in this release.",
    "engine": "models3d-advanced",
    "license": "Tencent Hunyuan 3D 2 Community",
    "licenseUrl": "https://huggingface.co/tencent/Hunyuan3D-2/blob/9cd649ba6913f7a852e3286bad86bfa9a2d83dcf/LICENSE",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256,
      384,
      512
    ],
    "sourceUrl": "https://github.com/Tencent-Hunyuan/Hunyuan3D-2",
    "downloadBytes": 9856304728,
    "runtimeReady": true,
    "licenseNotice": "Tencent\u2019s licence excludes use in the UK, EU and South Korea. Confirm that your use and distribution meet its terms; publication location alone does not decide this."
  },
  {
    "id": "hunyuan3d-2mv",
    "name": "Hunyuan3D 2 multiview",
    "minimum": "6 GB VRAM \u00b7 NVIDIA",
    "description": "Separate front, left, right and back references guide one shape.",
    "engine": "models3d-advanced",
    "license": "Tencent Hunyuan 3D 2 Community",
    "licenseUrl": "https://huggingface.co/tencent/Hunyuan3D-2mv/blob/3a761b539b29fe4ff64714813aa9560fd66f5de0/LICENSE",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": true,
    "resolutions": [
      128,
      256,
      384,
      512
    ],
    "sourceUrl": "https://github.com/Tencent-Hunyuan/Hunyuan3D-2",
    "downloadBytes": 4928153170,
    "runtimeReady": true,
    "licenseNotice": "Tencent\u2019s licence excludes use in the UK, EU and South Korea. Confirm that your use and distribution meet its terms; publication location alone does not decide this."
  },
  {
    "id": "hunyuan3d-2.1",
    "name": "Hunyuan3D 2.1",
    "minimum": "10 GB VRAM for shape \u00b7 NVIDIA",
    "description": "Geometry generation; no texture stage in this release. Upstream full shape + texture workflow requires 29 GB.",
    "engine": "models3d-advanced",
    "license": "Tencent Hunyuan 3D 2.1 Community",
    "licenseUrl": "https://huggingface.co/tencent/Hunyuan3D-2.1/blob/0b94677654c57bb9a6b6845cd7b704ccf551d327/LICENSE",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256,
      384,
      512
    ],
    "sourceUrl": "https://github.com/Tencent-Hunyuan/Hunyuan3D-2",
    "downloadBytes": 7366391846,
    "runtimeReady": true,
    "licenseNotice": "Tencent\u2019s licence excludes use in the UK, EU and South Korea. Confirm that your use and distribution meet its terms; publication location alone does not decide this."
  },
  {
    "id": "trellis2",
    "name": "TRELLIS.2",
    "minimum": "24 GB VRAM \u00b7 NVIDIA",
    "description": "High-detail geometry and PBR materials. The upstream supported platform is Linux.",
    "engine": "models3d-unpackaged",
    "license": "MIT + component model terms",
    "licenseUrl": "https://github.com/microsoft/TRELLIS.2/blob/main/LICENSE",
    "devices": [
      "auto",
      "cuda"
    ],
    "multiview": false,
    "resolutions": [
      128,
      256
    ],
    "sourceUrl": "https://github.com/microsoft/TRELLIS.2",
    "setupReason": "Setup pending: a verified Windows native dependency bundle and DINOv3 model access are required. No Windows runtime is bundled in this release.",
    "downloadBytes": 0,
    "runtimeReady": false
  }
]);
export const modelById = id => MODELS.find(model => model.id === id);
