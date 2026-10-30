---
'@docx-editor.dev/core': patch
---

Formatting at the caret of an empty paragraph applies to its paragraph mark as a document change with its own undo step, so Bold and other toggles turn off a format the mark already has. Fixes #1626.
