---
'@docx-editor.dev/core': patch
---

A table row whose cells all start or continue a vertical merge now takes its minimum row height. Before, it took one default text line, so a footer with such a row could push a page-tall row onto a page of its own.
