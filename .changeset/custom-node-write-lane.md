---
'@docx-editor.dev/pro': patch
---

Custom nodes can be inserted, updated and removed inside an open header, footer or note, instead of the write addressing the body and reporting that no node has that id. All three now refuse a document open for viewing rather than editing it: these writes go through the store, below the surface's editing-mode gate.
