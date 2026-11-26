---
'@docx-editor.dev/core': minor
---

The editor and PDF export now choose the same fallback face for a missing font family and for a character that a font lacks, so they break lines at the same places. Markdown export applies the same rules to a missing font family. `packagedFonts()` serves the symbol, mathematics, Arabic, and emoji fallback faces on demand; pass `fallbackFaces: false` to turn them off. A font resolver can receive one more request per document, for fallback faces by family name.
