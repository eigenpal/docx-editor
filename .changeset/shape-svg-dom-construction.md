---
'@eigenpal/docx-editor-core': patch
---

Build shape SVG via DOM APIs instead of innerHTML, preventing XSS from crafted DOCX shape attributes.
