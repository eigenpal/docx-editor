---
'@docx-editor.dev/core': minor
---

Glow, inner shadow, reflection, soft edge and bevel rim effects, WordArt outside watermarks, and EMF and WMF pictures in PDF export now render through `drawingModule()` from `@docx-editor.dev/pro/drawing`, which `reviewModule()` also installs. Without the module, shapes paint without these effects, WordArt keeps its placeholder, and the editor still rasterizes EMF and WMF pictures.
