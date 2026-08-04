---
'@docx-editor.dev/react': minor
---

Resolve table column widths from the widths the document actually authors. `w:tcW` now overrides the `w:tblGrid` seed the way Word resolves them, rows that disagree settle on the widest, and `w:wBefore`/`w:wAfter` size the bands a row skips. `w:tblW` bounds the total — including stretching a table stated as a percentage out to the full text column — and an autofit table no longer renders past the right margin, while a fixed-layout table still lays out on its grid the way Word renders it. Widths stated as `2in` or `33.3%` are read rather than dropped, and a table reports its own width instead of always the page width.
