---
'@docx-editor.dev/core': patch
---

Paragraph spacing of zero lines (`w:beforeLines="0"` or `w:afterLines="0"`) no longer removes the spacing in points beside it, so those paragraphs keep the space that Word shows.
