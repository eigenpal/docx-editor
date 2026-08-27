---
'@docx-editor.dev/core': patch
---

Grow a vertically merged cell by one row when you insert a row inside its span, instead of breaking the merge and shifting the grid. In a merged table, a row that holds a cell inside a content control refuses the insert rather than marking the wrong column. Fixes #57.
