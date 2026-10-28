---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Footnote and endnote numbering comes from each section's own note properties, including its start value, instead of the document-wide settings, and applying note properties to the whole document updates every section and keeps the values you did not change. Fixes #1527.
