---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
---

Fix long content in a table row getting cut off / hidden instead of flowing across pages. A table cell now measures its stacked paragraphs the way it paints them — collapsing adjacent paragraph before/after spacing (like Word) instead of adding it — so the row's height matches what's rendered and page breaks land on whole lines instead of slicing a line in two. Selecting text across a table that spans a page break no longer scatters selection highlights into the gap between pages, and contextual spacing is now suppressed inside table cells. Fixes #570.
