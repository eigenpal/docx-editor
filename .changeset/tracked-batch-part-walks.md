---
'@docx-editor.dev/core': patch
---

Batches of tracked edits that include content controls, paragraph splits, or text deletions apply much faster on long documents, because the editor no longer scans the whole document again for each of these operations.
