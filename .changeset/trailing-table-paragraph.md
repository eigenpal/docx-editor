---
'@eigenpal/docx-editor-core': patch
---

Ensure a document whose last element is an isolating block (a table, text box, or content control) gets a trailing empty paragraph, so the caret can be placed below it and text can be added after it (matches Word, which never lets a body end with a table).
