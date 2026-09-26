# Third-party notices

Unvara is released under the MIT License (see `LICENSE`). It builds on, bundles or downloads the following
third-party work. Each keeps its own license.

## Built on

### OpenCode

Unvara is a fork of [OpenCode](https://github.com/anomalyco/opencode) — the desktop app, UI and local agent server.

MIT License. Copyright (c) 2025 opencode.

## Bundled with the installer

### llama.cpp

`llama-server` (CPU and Vulkan builds) runs local models. Unvara pins one release per version of the app.

MIT License. Copyright (c) 2023-2026 The ggml authors. <https://github.com/ggml-org/llama.cpp>

The llama.cpp Windows builds include the LLVM OpenMP runtime, under the Apache License v2.0 with LLVM Exceptions
(its full text ships next to the engine as `LICENSE-LLVM-OpenMP`).

### Fonts

- **Inter** — SIL Open Font License 1.1. Copyright 2016 The Inter Project Authors.
- **Source Serif 4** — SIL Open Font License 1.1. Copyright Adobe (<http://www.adobe.com/>).
- **JetBrains Mono** — SIL Open Font License 1.1. Copyright 2020 The JetBrains Mono Project Authors.

The full license texts ship next to the font files in `packages/ui/src/assets/fonts/unvara/`.

## Adapted code and data

### llmfit

The model-fit scoring (quality penalties by quantization, speed from memory bandwidth) and the GPU memory-bandwidth
table in `packages/app/src/local-models/{fit,quant,gpu-bandwidth}.ts` are adapted from llmfit.

MIT License. Copyright (c) 2026 Alex Jones.

### Jan

GGUF quantization parsing from file names, the default-quant choice and the idea behind the model placement planner
in `packages/app/src/local-models/{quant,fit}.ts` are adapted from Jan.

Apache License 2.0. Copyright (c) Menlo Research. <https://github.com/menloresearch/jan>

## Downloaded on demand

These are fetched only when needed, verified against pinned SHA-256 hashes, and stored in Unvara's data folder.

- **llama.cpp CUDA builds and the NVIDIA CUDA runtime** (`cudart`), for NVIDIA graphics cards. llama.cpp is MIT
  licensed; the CUDA runtime is redistributed by the llama.cpp project under the NVIDIA CUDA Toolkit EULA.
- **Bun** — to run npm-based MCP connectors when Node.js isn't installed. MIT License. Copyright (c) Oven.
- **uv** — to run Python-based MCP connectors when uv isn't installed. MIT or Apache License 2.0.
  Copyright (c) Astral Software Inc.

## Models and connectors

Language models are downloaded from Hugging Face at your request and keep their own licenses (shown in the models
hub). MCP connectors from the gallery are installed from npm or PyPI at your request and keep their own licenses.
