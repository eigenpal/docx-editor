---
'@docx-editor.dev/pro': patch
---

Keep both relationships when two people add the first one to the same part at the same time, so a concurrently inserted image or hyperlink no longer ends up permanently broken. Undo no longer destroys text a collaborator typed into the same node while the undo was being made. Maintaining a node's child listing is now linear in its child count, which removes a slowdown when typing in a long document or a wide table.
