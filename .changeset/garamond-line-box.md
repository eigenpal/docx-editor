---
'@docx-editor.dev/core': patch
'@docx-editor.dev/docx-to-pdf': patch
---

Text in Garamond keeps the font's own line height when the font is not available, so its line spacing and page breaks no longer depend on the fallback font. Fixes #563.
