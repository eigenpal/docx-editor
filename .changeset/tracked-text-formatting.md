---
'@docx-editor.dev/core': patch
---

Run formatting (bold, italic, font family, font size, color) now applies to text inside tracked changes; it previously did nothing over runs wrapped in `w:ins` or `w:del`. Fixes #493
