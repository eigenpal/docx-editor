---
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
---

Add toolbar host groups, slot replacement, an Add comment control, and a table-size grid for the toolbar's table button, and make the menu bar move menus that do not fit into one "⋯" menu instead of wrapping by default (set `overflow={false}` to keep wrapping). The context-menu Add comment row id changed from `review.comments` to `review.addComment`, so a host that overrides that row must use the new id; `Menu.Item` and `ContextMenu.Slot` take `slotId`, and `slot` still works with a development warning.
