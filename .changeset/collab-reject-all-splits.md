---
'@docx-editor.dev/pro': minor
---

Breaking collaboration upgrade (format `docx-collaboration:1.5.3.1`): when participants split one paragraph at the same time with tracked changes on, each proposed paragraph break shows on its own paragraph, so Reject All restores the paragraph. Concurrent breaks in the text of one paragraph show in text order, also with several breaks per participant and after participants undo and redo them. See [Upgrade rooms to format 1.5.3.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1531). Fixes #1652.
