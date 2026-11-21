---
'@docx-editor.dev/core': patch
---

Report editing, formatting, and insert commands as unavailable where a table of contents refuses them, so the toolbar, `can()`, and `exec()` agree. Header, footer, and watermark changes succeed while the caret is in a table of contents. Arrow keys and Shift selection cross a table of contents to the text beside it, and Ctrl+Home, Ctrl+End, Page Up, and Page Down stop at the nearest editable position when a table of contents starts or ends the document.
