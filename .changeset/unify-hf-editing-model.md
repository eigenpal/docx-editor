---
'@eigenpal/docx-editor-core': patch
---

Header/footer editing now uses the body's hidden-PM + visible-painter model: one persistent off-screen EditorView per HF rId, with the painter as the sole visible renderer in both edit and non-edit modes. Click, drag, multi-click, selection rects, right-click, image select, hyperlink, table column/row/edge resize, and field inserts (PAGE/NUMPAGES) now route through a single pointer pipeline and match body parity. Fixes #468.
