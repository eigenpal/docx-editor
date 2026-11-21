---
'@docx-editor.dev/core': patch
---

Row edits in a long table lay out only the pages from the edited row onward, so their cost follows the rows after the edit, not the whole table. Fixes #1797
