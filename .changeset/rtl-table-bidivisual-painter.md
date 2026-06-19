---
'@eigenpal/docx-editor-core': patch
---

Render RTL tables (`w:bidiVisual`) with their columns in visual right-to-left order, matching Word. The bidi flag was already parsed and round-tripped, but the on-page painter still drew columns left-to-right, so in a right-to-left table a label cell appeared on the wrong side of the field it labels.

Fixes #734
