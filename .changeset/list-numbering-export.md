---
'@eigenpal/docx-editor-core': patch
---

Emit `word/numbering.xml` when exporting documents whose lists have no original numbering part

`createDocx()` (and any export of a document built from scratch — e.g. the editor with no source `.docx`) wrote `<w:numPr w:numId=…>` onto list paragraphs but never generated the backing `word/numbering.xml`, nor its content-type override / document relationship. Word couldn't resolve the dangling `numId`s, so it silently dropped every bullet and number marker — ordered/bulleted lists opened with no markers.

`fromProseDoc` now reconstructs the numbering definitions from the editor's list state (the list attrs were previously discarded on the no-base path), and the repacker serializes them to `word/numbering.xml` — registering the content-type override and relationship — when the package doesn't already ship one. Documents that already contain a `numbering.xml` are passed through unchanged.
