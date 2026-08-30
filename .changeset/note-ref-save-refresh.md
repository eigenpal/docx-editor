---
'@docx-editor.dev/core': minor
---

Saving now refreshes stale REF field results inside footnotes and endnotes as one undoable transaction with the body, so the exported note parts carry the values the pages paint; a field inside a locked or data-bound content control keeps its cached result without blocking the others, and collaborative sessions keep exporting cached results. Fixes #611
