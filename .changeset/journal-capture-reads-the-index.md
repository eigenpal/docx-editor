---
'@docx-editor.dev/core': patch
---

Typing in a large document with a collaboration replica attached no longer costs a scan of
every node id in the part on each edit, so an attached editor now runs at close to solo speed.
