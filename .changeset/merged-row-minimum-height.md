---
'@docx-editor.dev/core': patch
---

A table row whose cells all start or continue a vertical merge now takes the end-of-cell line of its first cell, or its minimum row height when that is taller. Before, it took one default text line, so a footer with such a row could push a page-tall row onto a page of its own.
