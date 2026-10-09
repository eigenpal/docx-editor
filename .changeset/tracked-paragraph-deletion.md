---
'@docx-editor.dev/editor-api': patch
---

With change tracking on, `paragraph.delete()` and `range.delete()` over whole paragraphs record tracked deletions of the text and paragraph marks, also in collaboration. Fixes #1174
