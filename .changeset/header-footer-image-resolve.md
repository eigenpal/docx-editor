---
'@docx-editor.dev/core': patch
---

Fix images in a header or footer staying on the loading placeholder forever. The picture decodes, but the page kept the furniture it was laid out with, so it never showed.
