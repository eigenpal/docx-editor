---
'@docx-editor.dev/core': minor
---

Add undoable DOCX replacement through `replaceDocument`, `Body.insertFileFromBase64(base64File, 'Replace')`, and document refresh `mode: 'edit'`. Remove collaborative comment thread records when undoing their replies. Fixes #1907, fixes #1934
