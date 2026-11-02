---
'@docx-editor.dev/core': patch
---

Saved documents give each tracked change its own id across the body, headers, footers, and notes, keep one id for the pieces of one change, and replace ids outside the 32-bit range. Fixes #1429.
