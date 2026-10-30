---
'@docx-editor.dev/pro': minor
---

Breaking collaboration upgrade (format `docx-collaboration:1.5.3.1`): when participants split one paragraph at the same time with tracked changes on, each proposed paragraph break shows on its own paragraph, so Reject All restores the paragraph, and concurrent splits show in text order, also with several splits per participant and after undo and redo. See [Upgrade rooms to format 1.5.3.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1531). Fixes #1652.
