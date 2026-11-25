---
'@docx-editor.dev/core': patch
---

Vertical merges of different lengths from one row now size their rows correctly over rows that can grow. Each merge grows its own last row to fit its text, and the first row keeps the height of its own cells. Before, a shorter merge was clipped at its first row or made its rows too tall. Fixes #2142
