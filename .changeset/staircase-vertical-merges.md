---
'@docx-editor.dev/core': patch
---

Table rows now keep their correct heights when a vertically merged cell starts inside another merged cell and ends below it, and merged cells whose last row has an exact height are clipped at that row instead of growing an earlier row.
