---
'@docx-editor.dev/core': minor
---

Add `editor.getSelectionRange()`, `snapshot().selectionRange`, and `editor.getCaretRect()` to read the selection as paragraph IDs and offsets and to place popovers at the caret, and make `setSelection` open the text box a range is in. A context menu opened with Shift+F10 or the Menu key now opens below the caret, and `useContextMenuAnchor()` reports how the menu was opened.
