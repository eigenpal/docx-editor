---
'@docx-editor.dev/react': minor
---

Place tables where the document puts them, and stop reserving blank lines for deleted paragraphs. `w:tblInd` and `w:jc` now indent, centre, or right-align a table instead of leaving every one flush left, and `w:tblCellSpacing` separates adjacent cells. A paragraph whose mark and content were both removed by a tracked deletion no longer claims a line box it renders nothing into — a table full of them was stacking blank lines and pushing real content off the page.
