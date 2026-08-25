---
'@docx-editor.dev/core': patch
---

Fix footnote placement in multi-section documents: a citation on a full page of a later section now reserves space on that page, so the note sits under its citation instead of draining onto the following pages. Fixes #460
