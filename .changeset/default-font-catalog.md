---
'@docx-editor.dev/react': minor
---

The font picker always offers a real catalog. A new or blank document used to open an empty picker ("no fonts declared") with an em-dash in the font box; the options are now the editor's configured font families — the default face, the Word-name families the substitution map covers, and any host-registered fonts — merged with what the document declares. The font box reports the default face (Calibri unless configured otherwise) for text with no authored font instead of showing nothing, while mixed selections still read as mixed. New `Editor.getAvailableFonts()` exposes the merged catalog; `getDocumentFonts()` is unchanged.
