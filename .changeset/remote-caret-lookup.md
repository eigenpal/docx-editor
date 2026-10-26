---
'@docx-editor.dev/core': patch
---

Remote carets no longer slow the editor in long collaborative documents, and a collaborator's caret no longer lands on the later of two paragraphs that came to share an id. Fixes #1498
