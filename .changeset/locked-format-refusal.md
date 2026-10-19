---
'@docx-editor.dev/core': patch
---

Bold, italic, font, size, and other text formatting commands now return `ok: false` with code `locked` when the document refuses them, for example over a content-locked control, instead of reporting success with no change. Fixes #1426
