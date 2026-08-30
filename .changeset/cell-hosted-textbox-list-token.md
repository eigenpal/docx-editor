---
'@docx-editor.dev/core': patch
---

Harden layout-cache invalidation for numbered lists inside text boxes: cell and header paragraph break keys now track the hosted list state, and layout token joins can no longer alias across file-controlled separators. Fixes #622
