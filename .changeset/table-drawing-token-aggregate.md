---
'@docx-editor.dev/core': patch
---

Invalidate a table's cached break correctly when drawing layout moves between its cell paragraphs: the drawing-token aggregate now preserves paragraph position instead of sorting, so two different token assignments can no longer alias. Fixes #626
