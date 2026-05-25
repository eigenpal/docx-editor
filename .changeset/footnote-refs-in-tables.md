---
'@eigenpal/docx-editor-core': patch
---

Footnote references authored inside table cells (and text boxes) are now collected by the page-reservation pass. Previously `collectFootnoteRefs` walked only top-level blocks and skipped tables entirely, so nested refs never reached `mapFootnotesToPages` and the per-page footnote area silently dropped them while the body still rendered the in-line superscript marker. Fixes #584.
