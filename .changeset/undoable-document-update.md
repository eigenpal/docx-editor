---
'@docx-editor.dev/core': minor
---

Add the `replaceDocument` editor command and `Body.insertFileFromBase64(base64File, 'Replace')`, which replace the document with a DOCX file as one undoable edit, and an undoable `mode: 'edit'` for document refresh. Undoing a comment reply in a collaboration session now also removes its thread record. Fixes #1907, fixes #1934
