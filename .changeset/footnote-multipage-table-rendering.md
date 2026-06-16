---
'@eigenpal/docx-editor-core': patch
---

Fix footnote rendering for footnotes referenced inside multi-page tables: reference marks now render superscript, the footnote-area number matches the note text's font, and a table that splits across pages distributes its footnotes to the page holding each row instead of dumping them all on the first table page.
