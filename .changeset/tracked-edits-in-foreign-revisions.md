---
'@docx-editor.dev/editor-api': patch
---

With `TrackMineOnly`, `Range.insertText()` and `Range.delete()` can edit another author's pending inserted or deleted text, and each author's change stays a separate decision that `Revision.accept()` and `Revision.reject()` resolve on its own.
