---
'@docx-editor.dev/core': patch
---

Vertical merges of different lengths from one row now size their rows correctly over rows that can grow, also when that row moves to the next page. Each merge grows its own last row to fit its text, and the first row keeps the height of its own cells. Fixes #2142
