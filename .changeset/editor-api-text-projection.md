---
'@docx-editor.dev/core': minor
'@docx-editor.dev/editor-api': minor
---

Add agent-safe document writing and revision APIs.

- Add an explicit `vanilla` text projection for automation reads and searches. Pending deletions
  remain visible, while pending insertions stay hidden.
- Add the atomic `replaceStoryBlocks` automation operation with stable paragraph identities.
- Add `revisionTextView` runtime configuration while preserving the Office.js object-model shape.
- Implement `proposeInsertion`, `proposeDeletion`, and `proposeReplacement` editor commands.
- Report forbidden paragraph marks through the specific `ParagraphMarkInText` error code.

Projected search ranges map back to editable model offsets and retain their projection for later
range reads and searches.
