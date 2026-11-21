---
'@docx-editor.dev/core': patch
---

Report editing and formatting commands as unavailable where a table of contents refuses them, so the toolbar, `can()`, and `exec()` agree. Shift selection extends across a table of contents, and Ctrl+Home, Ctrl+End, Page Up, and Page Down stop at the nearest editable position when a table of contents starts or ends the document.
