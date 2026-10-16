---
'@docx-editor.dev/pro': minor
---

Collaboration sessions add `beginUndoGroup()`, so a server agent can make each operation exactly one undo step and undo exactly that operation. An undo of typing that another participant moved by splitting its paragraph now removes only that typing, also without undo groups. Fixes #1385
