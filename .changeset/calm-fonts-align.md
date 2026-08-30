---
'@docx-editor.dev/fonts': minor
---

Match Word's widths and per-weight line box for documents that name Century Gothic, served on demand from the bundle by `googleFonts()`; `loadDefaultFonts()` and `defaultFonts()` now default to `WORD_DOCUMENT_DEFAULT_FAMILIES`, so `ALL_WORD_DEFAULT_FAMILIES` becomes an explicit opt-in that loads four more faces than before. Fixes #507.
