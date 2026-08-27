---
'@docx-editor.dev/core': patch
---

A cell merged over several rows now takes the height of the rows it covers instead of loading all of it onto the row it starts on, so the rows beside it keep their own heights and shading. Fixes #504
