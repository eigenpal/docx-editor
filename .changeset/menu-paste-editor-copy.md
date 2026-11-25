---
'@docx-editor.dev/core': minor
---

The context menu Paste now pastes the editor's last copy or cut, including a copied shape, line, or text box, when the browser refuses to read the clipboard. Custom Paste controls can use the new `readClipboardForPaste`, `hasEditorClipboardCopy`, and `writeTextToClipboard` functions. Fixes #2131
