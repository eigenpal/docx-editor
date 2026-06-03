---
'@eigenpal/docx-editor-core': minor
---

Fix the caret, drag-selection highlight, and table cell-selection highlight appearing in the header while editing the footer. The active header/footer is now resolved per section, so they render in the region being edited. The header/footer caret also stays glued to the text while scrolling instead of drifting away. The hovered region shows a text cursor in edit mode, and the inactive region shows a normal arrow. Fixes #671

The `@public` `computeHfCaretRectFromView` and `readHfSelectionGeometry` (exported from `@eigenpal/docx-editor-core/layout-bridge`) now take a required `section: 'header' | 'footer'` argument.
