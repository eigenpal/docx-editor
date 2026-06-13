---
'@eigenpal/docx-editor-core': patch
---

Fix "Delete row" so it removes every row a multi-cell selection spans, not just the anchor row. Selecting all rows now deletes the whole table, matching Word.
