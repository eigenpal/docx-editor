---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
'@docx-editor.dev/i18n': patch
---

Pasting an image file while a drawing is selected inserts it as an inline picture before the selected drawing's anchor. In suggesting mode, the editor refuses that paste and shows the reason, and the stale insert-target reasons no longer mention a drop. Fixes #2074
