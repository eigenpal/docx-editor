---
'@docx-editor.dev/editor-api': minor
---

`@docx-editor.dev/core` is now a peer dependency of `@docx-editor.dev/editor-api` instead of a regular dependency, so your project resolves one copy of the engine, shared with any editor adapter. Hosts whose package manager does not auto-install peers (for example Yarn) must add `@docx-editor.dev/core` explicitly.
