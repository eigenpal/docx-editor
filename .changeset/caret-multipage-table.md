---
'@eigenpal/docx-editor-core': patch
---

Fix the text cursor landing on the wrong page when a table cell's content spans a page break. The caret now follows the cell content onto the continuation page instead of staying on the previous page.
