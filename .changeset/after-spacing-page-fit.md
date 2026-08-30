---
'@docx-editor.dev/core': patch
---

Paragraph spacing-after no longer counts toward the page-fit decision: a line that fits stays on its page and trailing space clips at the boundary, so an oversized `w:after` (the signature-block idiom) no longer mints blank trailing pages. Fixes #615.
