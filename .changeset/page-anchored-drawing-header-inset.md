---
'@docx-editor.dev/core': patch
---

Anchored images in the document body now keep their place when a header or footer is taller than its margin. A page-relative image was pushed down the page by the header height, and a bottom-margin-relative one followed an oversized footer. Fixes #274.
