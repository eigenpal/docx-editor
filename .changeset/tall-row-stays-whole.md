---
'@docx-editor.dev/core': patch
---

In documents that declare compatibility mode 14 or earlier, or no mode, a text-only table row that cannot split and is taller than a page stays whole on one page and runs past the bottom margin instead of splitting. Fixes #1532.
