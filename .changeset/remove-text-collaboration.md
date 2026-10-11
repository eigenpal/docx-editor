---
'@docx-editor.dev/pro': minor
---

Remove the experimental `createTextCollaboration` factory; use `createDocumentCollaboration`, which now refuses an insert longer than the shared text limit before the edit applies, instead of dropping it.
