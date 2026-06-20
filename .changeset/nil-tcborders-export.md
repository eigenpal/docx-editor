---
'@eigenpal/docx-editor-core': patch
---

Preserve explicit `nil`/`none` borders on export. A cell that hides the table's default grid by setting `<w:tcBorders>` sides to `nil` no longer loses that override on save, so hidden gridlines stay hidden after a round-trip instead of re-inheriting the table's grid. The same applies to paragraph (`w:pBdr`) and page (`w:pgBorders`) borders, which had the identical bug. Fixes #947.
