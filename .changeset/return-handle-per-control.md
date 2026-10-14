---
'@docx-editor.dev/core': patch
---

`insertContentControl` with `returnHandle`, and Office.js `range.insertContentControl()`, return a handle to their own control when one batch creates several controls.
