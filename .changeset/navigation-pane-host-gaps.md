---
'@docx-editor.dev/core': minor
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
---

The navigation pane now works inside `DocxEditor.Viewport`, covers the page on narrow screens, and captures the browser's find shortcut (Ctrl+F, or Cmd+F on macOS) while focus is in the editor; set `findShortcut` to `false` on the pane, or in the `navigation` prop, to leave the shortcut to the browser.
