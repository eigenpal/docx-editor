---
'@docx-editor.dev/core': patch
---

Table styles now apply their cell margins and vertical alignment, including conditional formats such as the first row, and a cell margin side typed `nil`, `auto`, or `pct` no longer reads its number as a margin. In compatibility modes below 15, a table with an absolute width and no stated indent keeps its outer edge on the text edge, and a table style named `Table Normal` takes the built-in table properties in every mode.
