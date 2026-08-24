---
'@docx-editor.dev/editor-api': minor
---

`@docx-editor.dev/core` is now a peer dependency of `@docx-editor.dev/editor-api` instead of a regular dependency, so install it alongside; this guarantees your project resolves one copy of the engine, shared with any editor adapter.
