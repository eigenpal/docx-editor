---
'@docx-editor.dev/pro': minor
'@docx-editor.dev/core': patch
---

Add an `offlineEditing` option to the collaboration factories and hooks: a disconnected replica keeps accepting local edits, and the buffered updates merge on reconnect.
