---
'@docx-editor.dev/core': minor
'@docx-editor.dev/editor-api': minor
---

Add agent-safe document writing and revision APIs.

- Add an explicit `original` text projection. Pending deletions remain visible, while pending
  insertions stay hidden. This matches Word's Original review view.
- Add the atomic `replaceStoryBlocks` automation operation with stable paragraph identities.
- Add the DocxEditor `revisionTextView` runtime option outside the Office.js object model.
- Implement `proposeInsertion`, `proposeDeletion`, and `proposeReplacement` editor commands.

Projected search ranges map back to editable model offsets and retain their projection for later
range reads and searches.
