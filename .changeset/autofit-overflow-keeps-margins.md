---
'@docx-editor.dev/core': patch
---

An autofit table whose words do not fit the text column now keeps each cell's margins and takes the same share of content width from every column, so one long unbreakable word no longer collapses the other columns to hairlines. Fixes #1838
