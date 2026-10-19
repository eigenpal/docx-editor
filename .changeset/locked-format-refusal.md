---
'@docx-editor.dev/core': patch
---

Bold, italic, font, size, and other text formatting commands now return `ok: false` when the document refuses them, for example with code `locked` over a content-locked control, instead of reporting success with no change. Fixes #1426
