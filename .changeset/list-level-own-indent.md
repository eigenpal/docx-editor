---
'@docx-editor.dev/core': patch
---

A list item with its own indent now moves to the indent of its new level when Tab, Shift+Tab, Increase Indent, Decrease Indent, Enter on an empty item, or `listItem.level` changes its level, and keeps its right indent. Fixes #1720.
