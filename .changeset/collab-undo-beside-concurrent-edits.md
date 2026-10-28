---
'@docx-editor.dev/pro': patch
---

In a collaboration session, text that one participant deletes with a table row, column, or table stays deleted when another participant deletes the same content and undoes, and typing that a participant undoes no longer shows again in a copy that a concurrent join made. An undo next to moved blocks no longer removes another participant's text or leaves a moved table's empty paragraph without the identity that remote carets need. Fixes #1601.
