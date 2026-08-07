---
'@docx-editor.dev/core': patch
---

The y-prosemirror remote-cursor styles are now scoped to the editor. `.ProseMirror-yjs-cursor` is y-prosemirror's class name rather than one the engine mints, and it shipped unscoped, so a host running its own ProseMirror editor with Yjs on the same page had its remote cursors restyled. The stylesheet guard no longer treats `.ProseMirror-` as an engine-owned namespace.
