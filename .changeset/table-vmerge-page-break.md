---
'@eigenpal/docx-editor-core': patch
---

Render vertically-merged table cells like Word when a table crosses a page. Merged cells now keep their column and borders on the continuation page (instead of disappearing and shifting the other cells), and a tall merged cell flows its content across the page break (the row breaks mid-content like Word, honoring `w:cantSplit`). Each fragment closes with a border on the cut edge at the page break — including the merged column when it spans the boundary — and horizontal cell borders no longer render unevenly thick due to sub-pixel positioning. Fixes #666.
