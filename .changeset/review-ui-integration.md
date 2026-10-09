---
'@docx-editor.dev/core': minor
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
---

Toolbar and menu popups close when focus moves elsewhere, such as to the find field, and the navigation pane stays docked beside a scrolling review column. `Toolbar.Button`, `Menu.Item`, and `ContextMenu.Slot` take `slotId`; `slot` is deprecated and still works with a development warning, and on `MenuItemProps` and `MenuSubmenuProps` both `slot` and `labelKey` are optional, because `slotId` and `label` can take their place.
