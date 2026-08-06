---
'@docx-editor.dev/pro': minor
---

`saveForExport(editor)` produces the copy of a document that leaves your system, applying each definition's `preserveOnExport` to every node type registered on the editor; `editor.save()` is unchanged and still keeps every node. The bytes-level entry point, for a server with no editor, is now `prepareForExport`.
