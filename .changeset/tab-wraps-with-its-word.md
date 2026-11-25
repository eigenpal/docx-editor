---
'@docx-editor.dev/core': patch
---

A tab now stays with the word after it, as in Word. When that word would overflow the line, the tab opens the next line and reaches its stop there, instead of leaving the word to start the line at the margin. This keeps text such as a website after no-break spaces and a centre stop where Word puts it. A word too wide to follow its tab on a fresh line still opens the next line alone.
