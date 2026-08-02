---
'@docx-editor.dev/react': patch
---

Table style conditional formats now layer in Word's order. A header row keeps its shading instead of losing it to the banding fill underneath, and a `w:cnfStyle` written by the producer no longer switches off the first-column, last-column and corner formats that the table's own shape implies.

A table with no `w:tblLook` now bands like Word bands it. An absent element and an empty one are the same statement, and both mean row and column banding apply while the first/last row and column formats do not.

First column, last column and vertical banding follow the grid column a cell occupies, so a merged cell no longer shifts them onto its neighbours. `w:gridBefore` and `w:gridAfter` are honoured, and a one-row table can take the last-row format.

Applying "No Border" to a single cell now removes the interior rule. An explicit border of `nil` suppresses the line even when the neighbouring cell only inherits it from the table.

Border conflicts weigh width first. A thick dashed or dotted rule no longer loses to a hairline single, and a half-point double no longer beats a one-point single; style ranks only an exact tie.

Hostile column widths and row spans are bounded. A `w:gridCol` width and a row's total `w:gridSpan` are clamped the way every other table measurement already was.
