---
'@docx-editor.dev/react': minor
---

`useHighlights` now returns `refresh()` to run a highlight source again when your own state changes. Context menu rows can read the highlights under the right-click, or at the caret for a keyboard open, with `useContextMenuHighlights()`.
