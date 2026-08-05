---
'@docx-editor.dev/react': minor
---

The font picker always offers a real catalog. A new or blank document used to open an empty picker ("no fonts declared") with an em-dash in the font box; the options are now the editor's configured font families — the default face, the Word-name families the substitution map covers, and any host-registered fonts — merged with what the document declares. The font box reports the default face (Calibri unless configured otherwise) for text with no authored font instead of showing nothing, while mixed selections still read as mixed. New `Editor.getAvailableFonts()` exposes the merged catalog; `getDocumentFonts()` is unchanged.

Text with no authored font is now also painted in the default face it was measured in, instead of the page's inherited CSS font — visible glyphs no longer drift from wrap points and caret geometry in documents that never declare a font.

New `blankDocumentBytes()` returns a Word-faithful blank document — Calibri 11pt and Word's Normal paragraph spacing authored in `docDefaults`, US Letter with one-inch margins — so a "New document" behaves like Word's and saves to a file Word opens identically.
