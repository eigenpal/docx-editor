---
'@eigenpal/docx-editor-core': patch
---

Text highlight colors are restored when a document is reloaded. Custom highlight colors outside Word's named palette are saved as character shading (`w:shd`); the importer now reads that shading back into the highlight, so the background no longer disappears on reload even though it was always present in the exported file. Fixes #712.
