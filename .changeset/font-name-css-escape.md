---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
---

Escape embedded font-family names before interpolating into the injected `@font-face` stylesheet, and build the print window via DOM APIs instead of `document.write` string concatenation. Prevents CSS injection and print-time XSS from crafted DOCX font names.
