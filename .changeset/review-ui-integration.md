---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Toolbar and menu popups close when focus moves elsewhere, such as to the find field, the navigation pane stays docked beside a scrolling review column, and `Toolbar.Button` takes `slotId` like `Menu.Item`. On `MenuItemProps` and `MenuSubmenuProps`, `slot` and `labelKey` are now optional, because `slotId` and `label` can take their place.
