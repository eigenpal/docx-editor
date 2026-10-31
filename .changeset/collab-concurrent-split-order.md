---
'@docx-editor.dev/pro': minor
---

Breaking collaboration upgrade (format `docx-collaboration:1.5.3.1`): concurrent paragraph splits show in text order, Reject All restores a paragraph that peers split, rejecting a proposed paragraph break keeps the first paragraph, typing beside a run that a peer deletes stays in order and outside the proposed deletion, and edits beside moved blocks keep their text; export saved rooms with your current release and reseed them, see [Upgrade rooms to format 1.5.3.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1531). Fixes #1652, #1654, #1354, #1607.
