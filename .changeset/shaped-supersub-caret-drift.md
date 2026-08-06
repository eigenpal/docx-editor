---
'@docx-editor.dev/core': patch
---

Fix caret and hit-test drift on lines containing superscript or subscript text. The shaped measurer rounded the reduced super/subscript size to a whole half-point, measuring those runs up to 3% wider than they paint; the caret landed mid-glyph for the rest of the line.
