---
'@docx-editor.dev/pro': minor
---

Deleting text that carried comments or tracked changes now clears them from the review rail instead of leaving empty cards behind, matching Word: the comment record goes with the words it covered, and an untracked delete drops the `w:ins`/`w:del` it emptied. A reply to a tracked change renders inside that change's card rather than as a separate card beside it. Every card carries a delete control — it removes a comment thread, or discards a suggestion — through the new `Editor.deleteReviewItem` and `DocxEditor.Review.Delete`.
