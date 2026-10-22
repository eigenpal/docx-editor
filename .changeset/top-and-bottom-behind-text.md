---
'@docx-editor.dev/core': patch
---

A drawing wrapped top and bottom and offset from its paragraph keeps its band where the drawing is painted when its anchor sits on a later line of the paragraph, so the paragraph's own lines that the band crosses move below it instead of running under the drawing.
