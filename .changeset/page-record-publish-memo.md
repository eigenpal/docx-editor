---
'@docx-editor.dev/core': patch
---

Typing in a multi-page section keeps the section's untouched sheets identical across passes, so paint skips them, and repaints no longer walk the whole document to collect drawing keys.
