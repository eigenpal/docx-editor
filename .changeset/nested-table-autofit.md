---
'@docx-editor.dev/core': patch
---

Deeply nested tables open and edit faster: each nested table's column needs are measured once per layout pass instead of once for every enclosing level. Fixes #1798
