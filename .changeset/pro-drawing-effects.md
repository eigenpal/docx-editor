---
'@docx-editor.dev/core': minor
---

Glow, inner shadow, reflection, soft edge and bevel rim effects, WordArt outside watermarks, and EMF and WMF pictures now render through `drawingModule()` from `@docx-editor.dev/pro/drawing`. Without the module, shapes paint without these effects and WordArt and metafile pictures keep their placeholders, and `emf-converter` is no longer a dependency of `@docx-editor.dev/core`.
