---
'@docx-editor.dev/core': patch
---

A symbol is now one character of paragraph text that reads as "(", so the caret steps over it in one move, Backspace and Delete remove it, and search never matches it. Paragraph offsets after a symbol move by one.
