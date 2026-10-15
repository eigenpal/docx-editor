---
'@docx-editor.dev/editor-api': minor
---

Add `runtime.preview(callback)` to the browser automation runtime: it shows the callback's edits in the page without writing them, then commits them as one undo step or discards them, and collaboration peers receive nothing until the commit.
