---
'@docx-editor.dev/core': patch
---

Deleting the row where a vertical merge starts now moves the merge start to the next row instead of leaving a continuation with nothing to continue, `Table.deleteRows()` accepts tables with merged cells, and a continuation cell with no merged cell above it starts its own merge instead of hiding its content. Fixes #1069
