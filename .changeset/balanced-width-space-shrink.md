---
'@docx-editor.dev/core': patch
---

In a legacy compatibility mode that compresses punctuation, a document that balances single-byte and double-byte widths now shrinks inter-word spaces down to a quarter of the font size to keep one more word on a line. Fixes #1667.
