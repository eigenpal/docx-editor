---
'@docx-editor.dev/core': patch
---

Footnotes taller than the remaining page now start on their reference page, share it correctly with other references, and release their space when drained, so footnote-heavy documents paginate at the correct density. A `w:cantSplit` table row taller than the band a footnote reserve leaves now takes the full page instead of failing the layout. Fixes #608.
