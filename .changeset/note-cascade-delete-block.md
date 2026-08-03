---
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Deleting a fully selected table that contains a footnote or endnote reference now removes the note body in the same undo step instead of leaving an orphaned notes entry.
