---
'@docx-editor.dev/core': patch
---

Fix grouping and resolution of tracked table changes, including nested rows, cell formatting, shared grid histories, widths, alignment, and row heights. Related changes resolve together while preserving independent revisions, protected content, and unknown metadata.

Fix move-revision handling and partial-resolution reporting. Preserve existing nested tables when a row cannot be removed, and report `retained-structure` when its structural change remains pending.
