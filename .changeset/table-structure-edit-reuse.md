---
'@docx-editor.dev/core': patch
---

Row edits in a long table now cost time in proportion to the rows below the edit: the pages above it stay as they are, unchanged rows are not read or laid out again, and rows that only move keep their painted content. Fixes #1797
