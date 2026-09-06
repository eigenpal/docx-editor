---
'@docx-editor.dev/core': minor
---

Write a suggested replacement as Word does: the deletion first, then the insertion, each under its own revision id, wherever in the paragraph the replaced text sits. Add `replacementLanding` to the editor surface and the automation port, so a scripted replacement writes and reports the same position typing does. Fixes #691.
