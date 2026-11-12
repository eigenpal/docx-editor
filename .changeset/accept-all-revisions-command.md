---
'@docx-editor.dev/core': patch
---

The `acceptAllRevisions` and `rejectAllRevisions` editor commands now accept or reject every tracked change in the document in one undo step, instead of being refused. They require the review module.
