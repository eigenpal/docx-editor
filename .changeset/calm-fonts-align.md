---
'@docx-editor.dev/fonts': minor
---

Match Word's widths and per-weight line box for documents that name Century Gothic, served from the bundle by `googleFonts()` on demand. `loadDefaultFonts()` and `defaultFonts()` now load `WORD_DOCUMENT_DEFAULT_FAMILIES`, Word's five document defaults; `ALL_WORD_DEFAULT_FAMILIES` gains Century Gothic and is no longer the default, so passing it explicitly loads four more faces than before. Fixes #507.
