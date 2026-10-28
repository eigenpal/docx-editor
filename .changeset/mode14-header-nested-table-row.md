---
'@docx-editor.dev/core': patch
---

In compatibility mode 14 and earlier, a repeated table header stays above a row that opens with a nested table whose first row does not fit below it, also when the row is taller than a page, and that row stays whole past the bottom margin. Fixes #1582.
