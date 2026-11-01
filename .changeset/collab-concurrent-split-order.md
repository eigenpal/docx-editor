---
'@docx-editor.dev/pro': minor
---

Breaking collaboration upgrade (format `docx-collaboration:1.5.3.1`): concurrent paragraph splits show in text order, Reject All restores a paragraph that peers split, rejecting a proposed paragraph break keeps the first paragraph, undoing an inserted paragraph keeps text that others typed in it, and typing beside deleted, moved, or redone text keeps its place; export saved rooms with your current release and reseed them, see [Upgrade rooms to format 1.5.3.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1531). Fixes #1652, #1654, #1398, #1607, #1394, #1354.
