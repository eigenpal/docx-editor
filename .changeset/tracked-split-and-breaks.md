---
'@docx-editor.dev/core': patch
'@docx-editor.dev/editor-api': patch
---

With change tracking on, `Paragraph.split()` proposes each new paragraph mark, and `Range.insertBreak()` proposes page and next-page section breaks, as tracked changes that reject removes. Fixes #1617.
