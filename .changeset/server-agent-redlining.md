---
'@docx-editor.dev/core': minor
'@docx-editor.dev/editor-api': minor
---

Add Office-shaped server redlining through `Document.changeTrackingMode` and standard `Range.insertText`, `delete`, and `clear`. Collaborative agents can author real Word revisions and replicate them to open editors, with atomic commits, revision checks, and typed refusals for unsupported targets. `TrackMineOnly` is host-local; `TrackAll` explicitly refuses.
