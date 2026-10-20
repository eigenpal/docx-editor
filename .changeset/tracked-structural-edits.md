---
'@docx-editor.dev/editor-api': minor
---

The editing API proposes paragraph splits, fields, and equations as tracked changes through `insertText` with line feeds, `insertField`, `Field.result`, and `insertOoxml` for one equation. A proposed or struck paragraph mark now lists in `revisions.items` as an `Insert` or `Delete` revision instead of `ParagraphProperty`.
