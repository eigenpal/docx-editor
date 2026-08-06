---
'@docx-editor.dev/pro': patch
'@docx-editor.dev/core': minor
---

Custom nodes can be inserted, updated and removed inside a header, footer or note, including a node carrying a payload: the control lands in that story while its customXml store stays on the main document part, where Word looks for it. Which story a write targets now comes from the node or paragraph id rather than from wherever the reader happens to be, so a caller can address a node in a story it has left. Inserting, updating and removing all refuse a document open for viewing instead of editing it — these writes go through the store, below the editing-mode gate — and report the same `locked` code the engine's own refusal uses.
