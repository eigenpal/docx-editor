---
'@docx-editor.dev/pro': minor
---

`insertCustomNode` and `updateCustomNode` now take a single input object, and a definition can declare `toDocx` to derive its tag attrs and document text from its payload — so `insertCustomNode(editor, Citation, { data })` is the whole call and the three representations of a node cannot disagree. A payload the schema rejects returns `issues` carrying each failing field's path, and `exportCustomNodes` takes a `destination` so one call site covers both the copy you keep and the copy that leaves.
