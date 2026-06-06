---
'@eigenpal/docx-editor-vue': patch
---

Vue toolbar tooltips and the right-click text context menu now follow the active i18n locale instead of always rendering English. Shortcut-bearing buttons (bold, italic, underline, insert link, super/subscript, image properties) and every context-menu item (cut, copy, paste, delete, select all, table and image actions) route through `t()`.
