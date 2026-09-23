---
'@docx-editor.dev/core': patch
---

Fix slow download file names, layout, and Markdown conversion for text with long runs of spaces or dots. Download names also prefix Windows device names that have an extension, such as `_NUL.tar.docx`, and no longer double a padded `.docx` suffix.
