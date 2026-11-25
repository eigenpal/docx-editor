---
'@docx-editor.dev/core': patch
---

A table row that holds only vertical merge heads and continuations now takes the height of its first cell's end-of-cell paragraph, or its minimum row height when that is taller. Before, it took one default text line or no height, so a footer with such a row could push a page-tall row onto a page of its own.
