---
'@docx-editor.dev/core': patch
---

Rejecting a tracked paragraph break keeps the paragraph before it, so in a collaboration session a rejection and an undo of the same split no longer delete the paragraph. Fixes #1654.
