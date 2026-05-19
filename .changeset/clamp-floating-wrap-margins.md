---
'@eigenpal/docx-editor-core': patch
---

Clamp floating table and image wrap margins when they exceed the content width, fixing collapsed single-glyph line layout after near-full-width floating tables. Same fix applied at both wrap-zone sites: `rectsToFloatingZones` (page paint) and the React adapter's `extractFloatingZones` (pre-measurement scan).
