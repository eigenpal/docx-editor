---
'@docx-editor.dev/core': patch
---

Text formatting over a selection that includes a content-locked control is now reported as unavailable by `can()` and the toolbar, and `exec` returns `ok: false` instead of reporting success with no change. Fixes #1426
