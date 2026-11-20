---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Pasting an image file while a drawing is selected inserts it as an inline picture before the selected drawing's anchor. In suggesting mode, the editor refuses that paste and shows the reason. Fixes #2074
