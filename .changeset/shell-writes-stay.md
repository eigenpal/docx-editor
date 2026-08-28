---
'@docx-editor.dev/core': patch
---

A relationship, content type, or extra part written through a transaction's `applyPackage` now survives into the package, the save, and one shared undo unit with the story edit, instead of replicating to peers while vanishing from the author's own document. Fixes #558.
