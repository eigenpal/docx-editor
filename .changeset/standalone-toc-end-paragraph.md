---
'@docx-editor.dev/core': patch
---

Keep the separate closing line of a populated table of contents in layout, and let the caret, Shift selection, typing, and section breaks reach it. Content inserted at the start or end of a table of contents goes outside the field, so a refresh keeps it, and commands that would write into its entries report as unavailable in the toolbar, `can()`, and `exec()`.
