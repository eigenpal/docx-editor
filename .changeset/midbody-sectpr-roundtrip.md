---
'@eigenpal/docx-editor-core': patch
---

Preserve mid-body section breaks (`w:pPr/w:sectPr`) on headless roundtrip. A parseDocx → repackDocx roundtrip no longer collapses a multi-section document down to its final section. Fixes #680.
