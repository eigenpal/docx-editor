---
'@docx-editor.dev/core': minor
---

Put the caret in the right place on an empty paragraph. A centred or right-aligned one drew it at the left margin, and one with a first-line indent ignored the indent; in both cases it only jumped to the correct position once a character was typed. Lines now publish their aligned content origin as `LineRecord.contentX`.
