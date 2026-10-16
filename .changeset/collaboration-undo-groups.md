---
'@docx-editor.dev/pro': minor
---

Collaboration sessions add `beginUndoGroup()`, so a server agent can make each operation exactly one undo step and undo it without reverting other edits. Fixes #1385
