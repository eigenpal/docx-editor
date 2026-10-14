---
'@docx-editor.dev/core': minor
---

Show the editor in a pop-out window or an iframe, and move it between windows without losing edits, undo history, the selection, or the collaboration session. `detach()` keeps the document for the next `attach()` instead of resetting it; call `destroy()` to release it. Fixes #1312
