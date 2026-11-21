---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
'@docx-editor.dev/i18n': patch
---

The React and Vue editors show the translated reason when they refuse to copy, cut, or paste on a selected drawing, in the same dialog as a refused picture insert. The `imageInsertError` dialog takes an optional `title` that names the refused action. Fixes #2087
