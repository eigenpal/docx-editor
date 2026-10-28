---
'@docx-editor.dev/core': patch
---

A fixed-height table row that ends a page now keeps its authored height with the table's bottom border below it, and moves to the next page when that border does not fit. A fixed-height row that opens a later page of its table grows by the extra width of the top border there. Fixes #1534.
