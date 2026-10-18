---
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Changing the `fonts` prop now replaces the fonts without remounting the editor, so edits, selection, and undo history are kept, and the current fonts stay in use until the new ones are ready.
