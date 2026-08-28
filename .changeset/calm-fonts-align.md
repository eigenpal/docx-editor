---
'@docx-editor.dev/fonts': minor
---

Match Word's widths and line box for documents that name Century Gothic. `defaultFonts()` now loads Word's five document-default families; pass `families: ALL_WORD_DEFAULT_FAMILIES` or use `googleFonts()`, which serves Century Gothic on demand. Fixes #507.
