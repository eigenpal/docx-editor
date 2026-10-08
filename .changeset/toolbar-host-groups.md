---
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
---

Add `Toolbar.Group`, `Toolbar.Slot`, and `Toolbar.AddComment` so host controls collapse into the toolbar's More panel, replace built-in slots, or hide whole groups, and the toolbar's table button (`Toolbar.TableInsert`) now opens a table-size grid instead of inserting a 1×1 table. The menu bar collapses menus that do not fit into one "⋯" menu (`overflow` prop), More panels stay inside the viewport, and a content-width toolbar brings collapsed groups back when it has room again.
