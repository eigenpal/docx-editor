---
'@docx-editor.dev/core': patch
---

Before compatibility mode 15, a table row that cannot split and is taller than the page no longer starts on a page that a continued footnote reaches; that page holds the footnote and the row starts after it. Fixes #1570.
