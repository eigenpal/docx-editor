---
'@eigenpal/docx-editor-core': patch
---

Fix the selection sliver not showing for empty paragraphs. Dragging a selection across a blank paragraph now paints the same fixed-width highlight already shown for `<br>` blank rows — `readSelectionGeometry` now falls back to the enclosing `.layout-paragraph` position for unpositioned `.layout-empty-run` lines, mirroring the click/caret resolvers.
