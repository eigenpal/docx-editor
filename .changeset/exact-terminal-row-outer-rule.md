---
'@docx-editor.dev/core': patch
---

A fixed-height last table row keeps its authored height, with its bottom border placed below it and cell text aligned to the authored bottom. If the row does not fit with its border, it moves to the next page unless it starts the page, and repeated header rows that leave no room for the border are omitted in compatibility mode 15 and later.
