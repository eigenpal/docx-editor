---
'@docx-editor.dev/core': patch
---

Size AutoFit table columns from their content: a column widens to hold its widest unbroken word, columns whose cells state no width take their content's width, a spanning cell widens the columns it spans, a nested fixed table fits its cell, and cell spacing separates cells by twice its value. Fixes #1067
