---
'@docx-editor.dev/docx-to-pdf': patch
---

PDF export now refuses a font glyph whose composite parts nest too deeply or refer to themselves, instead of hanging or failing the whole export.
