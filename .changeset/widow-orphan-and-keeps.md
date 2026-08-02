---
'@docx-editor.dev/react': patch
---

Paginate like Word: keep widows and orphans off page boundaries, keep a heading with the paragraph it introduces, and keep a paragraph's lines together when it asks for it. Widow and orphan control is on by default, as it is in Word, so this changes page breaks in documents that never set it. Also honours right- and left-aligned tab stops written in the ISO 29500 Strict spelling, which previously dropped the stop and pushed table-of-contents page numbers to a default tab.
