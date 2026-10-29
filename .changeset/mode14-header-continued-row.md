---
'@docx-editor.dev/core': patch
---

In compatibility mode 14 and earlier, a repeated table header stays above a row that continues from the previous page when its next line or nested table does not fit below the header, and the rest of the row stays on that page. Fixes #1602.
