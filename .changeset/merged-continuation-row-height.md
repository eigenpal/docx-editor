---
'@docx-editor.dev/core': patch
---

A table row whose cells all continue a vertical merge now takes the height of its first cell's end-of-cell paragraph instead of its tallest cell. When the first cell of a row of merged cells hides its end mark, the row takes one line of the default paragraph style.
