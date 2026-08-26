---
'@docx-editor.dev/core': patch
---

Headless automation writes now publish to a collaboration replica before the call returns, so a script that edits and then reads a peer no longer sees the document as it stood before the edit.
