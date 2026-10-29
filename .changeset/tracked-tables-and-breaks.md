---
'@docx-editor.dev/core': patch
---

Rejecting all changes after a table is inserted as a suggestion now gives back the original paragraphs, and a table inserted at the end of a paragraph no longer adds an empty paragraph after it. Splitting a paragraph right after a field that edits as one unit now keeps the whole field in the first paragraph. Fixes #1609.
