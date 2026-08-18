---
'@docx-editor.dev/core': minor
---

The text shaper and its WASM now ship inside the package, so browser builds no longer fail with `Module not found: Can't resolve 'module'`, and the new `setHarfBuzzWasmUrl` from `@docx-editor.dev/core/layout` points bundlers that do not emit `new URL(..., import.meta.url)` assets (esbuild, Bun) at a self-hosted `harfbuzz.wasm`. Server-side shaping over ESM now needs Node 20.16 or 22.3 and later, declared in `engines`. Fixes #282
