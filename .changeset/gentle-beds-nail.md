---
'@eigenpal/docx-editor-core': patch
---

Fix CJK text overflowing the right margin when a document's theme leaves the East Asian font slot empty. The East Asian theme font is now resolved from the document's `w:themeFontLang` (e.g. Japanese → MS Mincho), so line breaking and rendering use the correct font and wrap within the page.
