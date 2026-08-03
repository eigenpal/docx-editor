---
'@docx-editor.dev/core': minor
---

Keep autofit tables inside the page and read authored cell widths. A table left on Word's autofit layout now scales to the text column instead of running past the right margin, a table that states no `w:tblGrid` takes its columns from `w:tcW` rather than an even split, and a table's reported width is its own rather than always the page width. Tables that ask for fixed layout are still laid out on their grid, overflow included, as Word renders them.
