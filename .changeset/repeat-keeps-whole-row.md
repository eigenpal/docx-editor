---
'@docx-editor.dev/core': patch
---

In documents that declare compatibility mode 14 or earlier, or no mode, repeated header rows stay on a continuation page above a row that cannot split and does not fit below them, and that row runs past the bottom margin. Fixes #1538.
