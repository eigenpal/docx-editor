---
'@docx-editor.dev/core': patch
---

Fix CJK punctuation overlap when `characterSpacingControl` enables compression. Preserve ordinary brackets and authored spaces, compress qualifying punctuation seams, and position opening glyphs inside their reduced advances.
