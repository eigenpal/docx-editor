---
'@docx-editor.dev/react': minor
---

Right-clicking the document now opens an editor menu: Cut, Copy, Paste, Delete, Select All, Link and Comment, each greyed out with the engine's own reason when it cannot run. `contextMenu={false}` restores the browser's menu.

`DocxEditor.ContextMenu` composes the same way the toolbar and menu bar do — a row child replaces that row in place, `hidden` removes it, `preset={false}` starts from nothing, and `ContextMenu.Item` adds an action of your own. Its rows are the menu bar's rows, so a row looks and behaves the same in both.

`selectAll`, `copy`, `cut` and `paste` are new editor commands, so a host can run them from its own UI. `paste` takes the text to insert, because reading the clipboard needs a permission gesture that belongs to the caller.
