---
'@docx-editor.dev/react': patch
---

Increase Indent now works on any list item, even when the document's list definition stops at the current level. The missing level is declared with Word's default format for that depth — bullets cycle •, o, ▪ and numbered lists cycle decimal, letters, roman — instead of the control greying out. Decrease Indent restores the item's own authored level on the way back.
