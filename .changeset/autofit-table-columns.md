---
'@docx-editor.dev/core': patch
---

Autofit table columns no longer widen for spaces that open a cell, keep `w:noWrap` cells at their preferred width, and size first-line indents by the document's compatibility mode. A top-level autofit table whose absolute width is past the text column is laid out at that width.
