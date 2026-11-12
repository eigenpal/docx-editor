---
'@docx-editor.dev/core': patch
---

Upright shapes without text now paint their whole geometry and outline past their box, such as a callout's tail, and a negative effect extent no longer cuts them. A press on the part past the box selects the shape. Fixes #1946
