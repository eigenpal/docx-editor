---
'@docx-editor.dev/core': patch
---

Price the `w:keepNext` group-height lookahead at the placed column's width, so a keep group in a section with unequal explicit column widths breaks on the correct block. Fixes #623
