---
'@docx-editor.dev/core': minor
---

ESM browser builds no longer fail with `Module not found: Can't resolve 'module'`, and the new `setHarfBuzzWasmUrl` points bundlers that emit no WASM asset (esbuild, Bun) at a self-hosted `harfbuzz.wasm`. Server-side shaping over ESM now needs Node 20.16 or 22.3 and later. Fixes #282
