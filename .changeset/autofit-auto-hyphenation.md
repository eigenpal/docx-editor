---
'@docx-editor.dev/core': patch
---

Fix autofit table columns that widened for a long word in a compatibility mode 15 document with automatic hyphenation. The column now keeps its preferred width, and words in capitals stay whole when the document sets `w:doNotHyphenateCaps`.
