---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
'@eigenpal/docx-editor-vue': patch
---

Fix caret size and table insert button position when the editor is zoomed. Both are painted inside the zoomed page container, so their geometry is now normalized by the zoom factor instead of being scaled twice.

Fixes #928
