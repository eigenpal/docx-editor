---
'@eigenpal/docx-editor-react': minor
'@eigenpal/docx-editor-vue': minor
---

Add `scrollToCommentId`, `scrollToChangeId`, and `highlightRange` methods to `DocxEditorRef` on both the React and Vue adapters, for revealing a location in the editor. Each scrolls the comment, tracked change, or position range into view and selects it so the selection overlay highlights the spot. `scrollToCommentId` and `scrollToChangeId` return `false` when the id no longer resolves, so callers can surface a "location no longer exists" affordance instead of silently doing nothing.
