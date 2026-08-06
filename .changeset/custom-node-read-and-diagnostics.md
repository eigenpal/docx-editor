---
'@docx-editor.dev/pro': minor
---

`customNodesOf(editor)` answers every recognized custom node in the document with its payload, so reading them no longer means reaching for three engine internals. Diagnostics are now scoped to the editor whose module registered them: two editors on one page hear only their own documents, and a listener goes when its editor does.
