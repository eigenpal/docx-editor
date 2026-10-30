---
'@docx-editor.dev/pro': minor
---

Breaking collaboration upgrade (format `docx-collaboration:1.5.3.1`): when two participants split one paragraph at different points at the same time, the new paragraphs show in text order, and rejecting a proposed paragraph break while its author undoes it keeps the paragraph, because rejecting an inserted paragraph mark now keeps the first paragraph, so `Paragraph` objects of the second paragraph stop resolving. Export saved rooms with your current release and reseed them; see [Upgrade rooms to format 1.5.3.1](https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions#upgrade-rooms-to-format-1531). Fixes #1654.
