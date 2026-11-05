---
'@docx-editor.dev/core': patch
---

Text painted in an embedded or supplied font now sits at the advances that layout measures in Chromium on Linux, so highlights, the selection, and the caret no longer drift from the painted glyphs along a line. The canvas measurer now asks for the same unhinted advances. In Chromium on Linux, text that layout measures with the canvas, such as text in a font that the document does not embed, can measure a different width than before, so lines and page starts of such documents can move.
