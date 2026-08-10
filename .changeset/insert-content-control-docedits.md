---
'@docx-editor.dev/core': minor
---

Add `insertContentControl` to `DocEdits`, so a mounted editor can create a content control as well as set and remove one.

The tree op already existed and was reachable only through the automation protocol, which meant a host with an editor mounted had to `save()`, insert through a headless automation host, and `load()` the result back — discarding the undo stack. The insertion is now a single undoable step like every other edit.

Wraps the current selection; refuses a collapsed caret and a selection that crosses paragraphs, since a control spanning paragraphs is a block wrapper rather than the inline one this authors.
