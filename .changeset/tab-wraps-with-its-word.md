---
'@docx-editor.dev/core': patch
---

A tab now moves to the next line with the word after it when that word would overflow the line, and reaches its tab stop there. Before, the tab stayed at the line end and the word started the next line at the margin. A word too wide to follow its tab on a fresh line still opens the next line alone.
