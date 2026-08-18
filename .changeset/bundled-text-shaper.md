---
'@docx-editor.dev/core': minor
---

Browser builds no longer fail to resolve `module`, and the new `setHarfBuzzWasmUrl` points bundlers that emit no WASM asset (esbuild, Bun) at a self-hosted `harfbuzz.wasm`. Upgrade `@docx-editor.dev/core` itself to get the fix. Fixes #282
