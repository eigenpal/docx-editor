---
'@eigenpal/docx-editor-agents': minor
---

`DocxReviewer` can now accept/reject tracked changes inside footnote and endnote bodies. Pass a `ReviewChange` from `getChanges` (it carries `noteId`/`noteType`) to `acceptChange`/`rejectChange` to resolve a change wherever it lives, or use `acceptAll`/`rejectAll` with `{ includeFootnotes, includeEndnotes }` to resolve note changes in bulk. The result persists through `toBuffer()`. Previously these methods operated on the document body only; the numeric `acceptChange(id)` form is unchanged.
