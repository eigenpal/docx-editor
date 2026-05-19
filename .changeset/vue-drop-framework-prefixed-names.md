---
'@eigenpal/docx-editor-vue': patch
---

Drop framework-prefixed names from Vue's public surface — the package name already encodes the framework, so `Vue`-prefixed identifiers are redundant in consumer code.

Renames `VueRenderAsyncOptions` → `RenderAsyncOptions` in `packages/vue/src/renderAsync.ts`. The previous compat alias (`VueRenderAsyncOptions as RenderAsyncOptions`) is dropped — `RenderAsyncOptions` is now the only exported name. Matches React's `RenderAsyncOptions` 1:1.

Adds `EditorPlugin` as a type alias for `VueEditorPlugin` in `packages/vue/src/plugin-api/types.ts`, mirroring React's `EditorPlugin` / `ReactEditorPlugin` pair. Consumers writing `import { EditorPlugin } from '@eigenpal/docx-editor-vue/plugin-api'` now resolve. `VueEditorPlugin` stays exported for callers who want the framework-explicit name.

No runtime change.
