---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Footnote and endnote numbering comes from each section's own note properties instead of the document-wide settings, and applying note properties to the whole document updates every section. Fixes #1527.
