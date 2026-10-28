---
'@docx-editor.dev/core': patch
---

In compatibility mode 15 and later, the last word of a right-to-left run that ends with its own space needs room for that space in a justified left-to-right line, so the rest of the run continues in the next passage beside a floating object or on the next line. Fixes #1603.
