---
'@eigenpal/docx-editor-agents': patch
---

Add `DocxReviewer.removeComment(id)` — removes a comment (and its replies when called on a top-level thread) along with its anchored range markers. Closes #252.
