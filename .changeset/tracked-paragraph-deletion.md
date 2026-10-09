---
'@docx-editor.dev/editor-api': minor
---

With change tracking on, `paragraph.delete()` and `range.delete()` over whole paragraphs record tracked deletions of the text and paragraph marks, also in collaboration. Breaking collaboration upgrade: this ships with collaboration format 1.4.2.1; see [Upgrade rooms to format 1.4.2.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1421). Fixes #1174
