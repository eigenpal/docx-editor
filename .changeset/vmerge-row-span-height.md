---
'@docx-editor.dev/core': patch
---

A cell merged over several rows now takes the height of the rows it covers instead of loading all of it onto the row it starts on, so the rows beside it keep their own heights and shading. A `w:cantSplit` row holding such a merge can now split across a page rather than failing the table's layout. Fixes #504
