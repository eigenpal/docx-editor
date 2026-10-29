---
'@docx-editor.dev/core': patch
---

In older compatibility modes with punctuation compression and an East Asian default font, a line at any alignment shrinks its spaces down to half the average character width of their font to keep one more word, unless the document balances single-byte and double-byte widths. Fixes #1635.
