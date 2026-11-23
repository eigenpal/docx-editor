---
'@docx-editor.dev/pro': minor
---

Breaking collaboration upgrade (format `docx-collaboration:1.5.6.1`): concurrent paragraph splits keep text order inside a paragraph that an earlier concurrent split created, rejecting the tracked paragraph breaks of one participant keeps the breaks of the others, and undo and redo of such splits keep the text order and the other participants' breaks and formatting. Export saved rooms with your current release and reseed them, as described in [Upgrade rooms to format 1.5.6.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1561). Fixes #1972
