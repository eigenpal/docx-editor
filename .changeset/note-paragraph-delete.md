---
'@docx-editor.dev/core': minor
---

Deleting a paragraph or table inside a footnote, endnote, comment, or text box now works when that story keeps another paragraph, and the caret stays in it. Deleting the last paragraph of a story or table cell, or the last row or column of a table, now fails with `NotSupported` and the new `edit.content-required` diagnostic instead of `GeneralException` and `edit.stale-target`. Fixes #2039
