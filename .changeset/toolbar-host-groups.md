---
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
---

Add toolbar host groups, slot replacement, an Add comment control, and a table-size grid for the toolbar's table button, and make the menu bar move menus that do not fit into one "⋯" menu instead of wrapping by default (set `overflow={false}` to keep wrapping). The context-menu Add comment row is now `review.addComment`, and `Menu.Item` and `ContextMenu.Slot` take `slotId`; `review.comments` and `slot` still work in this release with a development warning, so rename them.
