---
'@docx-editor.dev/core': patch
---

Fix autofit table columns that shrank for a long word in `w:caps` or `w:smallCaps` text when the document sets `w:doNotHyphenateCaps`. These words now stay whole, as words typed in capitals do.
