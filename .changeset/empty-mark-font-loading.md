---
'@docx-editor.dev/core': patch
---

PDF export loads the fonts that empty paragraphs and empty table cells are measured with, so their lines have the correct height when no text uses those fonts.
