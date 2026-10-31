---
'@docx-editor.dev/editor-api': patch
---

A cell returned by a vertical `Table.mergeCells()` now accepts `shadingColor` and `verticalAlignment` writes in the same sync, and they apply to every row of the merged cell. A text edit in that table in the same sync now refuses with `ConflictingChanges` instead of landing before the merged text.
