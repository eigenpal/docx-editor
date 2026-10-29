---
'@docx-editor.dev/editor-api': patch
---

A load on an object that a write returns, such as the range from `insertText()`, can share that write's `context.sync()` and reports the inserted content. Fixes #1625.
