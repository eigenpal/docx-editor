---
'@eigenpal/docx-editor-core': minor
---

Vue: enable drag-to-select table cells, matching React. Dragging across cell boundaries now produces a cell selection, so multi-cell operations (delete row/column across a range, fill, merge) are reachable by dragging. The cell-drag logic is shared between React and Vue in core.
