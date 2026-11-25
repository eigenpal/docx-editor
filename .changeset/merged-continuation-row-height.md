---
'@docx-editor.dev/core': patch
---

A table row whose cells all continue a vertical merge now takes the height of its first cell's end-of-cell paragraph instead of its tallest cell. When that first cell hides its end mark, the row keeps one line of the default paragraph style instead of no height.
