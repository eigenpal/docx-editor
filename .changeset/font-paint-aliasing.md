---
'@docx-editor.dev/react': minor
---

Fonts embedded in a DOCX now paint with their real glyphs, not just measure with them. The bytes are registered with the browser under an internal alias rather than the family name the document declares, so a file can never repaint the host application's own UI. New `createFontSource(bytes, request)` turns font bytes you already hold into a composable source with the hash computed for you, and `loadFonts` now fetches its URLs concurrently, refuses responses that are not fonts (an HTML error page served with 200 no longer poisons the cache), and reports both as typed per-source failures. The shaped-font remount no longer drops keyboard focus.
