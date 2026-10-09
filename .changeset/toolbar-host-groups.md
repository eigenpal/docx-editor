---
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
---

Add toolbar host groups, slot replacement, an Add comment control, and a table-size grid for the toolbar's table button, and make the menu bar move menus that do not fit into one "⋯" menu instead of wrapping by default (set `overflow={false}` to keep wrapping). The context-menu row id `review.comments` is deprecated in favor of `review.addComment`, and the old id still works with a development warning.
