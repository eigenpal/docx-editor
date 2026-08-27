---
'@docx-editor.dev/core': minor
---

Tables match Word's default cell metrics: a table that names no style resolves the document's default table style, cell margins fall back to Word's own values, the paragraph Word writes to close a cell after a nested table takes no height, and a single-spaced line box includes the font's line gap. `StyleCascadeTable` gains `defaultTableStyleId`, and `DEFAULT_CELL_MARGINS` is no longer a uniform 3pt.
