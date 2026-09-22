---
'@docx-editor.dev/core': minor
---

`openFontBackedDocumentForExport` accepts `lastResortFonts`, font origins composed after the document's embedded fonts, so an exporter can stand in for a family nothing else covers without shadowing a face the document carries.
