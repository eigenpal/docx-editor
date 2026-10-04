---
'@docx-editor.dev/core': patch
---

Non-breaking and optional hyphens are now characters of paragraph text (U+001E and U+001F), so text reads, search, selection, and deletion include them, inserted U+001E and U+001F become hyphens, and deleting text across a symbol removes it. Paragraph offsets after a hyphen move by one. Fixes #1071
