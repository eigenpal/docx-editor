---
'@eigenpal/docx-editor-react': minor
---

Add `scrollToCommentId`, `scrollToChangeId`, and `highlightRange` methods to `DocxEditorRef` for revealing a location in the editor — scroll the comment, tracked change, or position range into view and flash a transient highlight. `scrollToCommentId` and `scrollToChangeId` return `false` when the id no longer resolves, so callers can surface a "location no longer exists" affordance instead of silently doing nothing.
