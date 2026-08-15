---
'@docx-editor.dev/editor-api': minor
---

Fix story-scoped revision collections so they resolve every store-resolvable change in that story, including complete tracked rows, and refuse atomically when any unsupported revision remains.
