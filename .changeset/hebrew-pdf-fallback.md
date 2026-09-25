---
'@docx-editor.dev/docx-to-pdf': patch
---

PDF export now draws Hebrew text in a run whose font has no Hebrew glyphs in Times New Roman, or in Liberation Serif where Times New Roman is not installed, instead of dropping it.
