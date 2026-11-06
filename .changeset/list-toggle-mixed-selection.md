---
'@docx-editor.dev/core': patch
---

The list buttons now start a new list for a selection of list items and plain paragraphs, unless the selection starts with a plain paragraph below a list item of the same kind, which joins that list together with the selected items. Fixes #1851
