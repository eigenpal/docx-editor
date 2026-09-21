---
'@docx-editor.dev/core': patch
---

A floating object with `w:layoutInCell="0"` inside a table cell no longer pushes that cell's text across. The object is positioned against the page, so the cell's text runs past it.
