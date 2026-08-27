---
'@docx-editor.dev/core': patch
---

Tables match Word's default cell metrics: a table that states no `w:tblStyle` resolves the document's default table style, cell margins fall back to Word's 0 top, 0 bottom and 0.08" sides, the empty paragraph a cell must end with after a nested table costs the row no height, and a single-spaced line box includes the face's line gap.
