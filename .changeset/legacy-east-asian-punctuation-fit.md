---
'@docx-editor.dev/core': patch
---

Documents in a legacy compatibility mode now compress East Asian punctuation to fit lines at every paragraph alignment. On every line, justified ones included, the added text takes at most half its width in compression, and Korean text and marks are not compressed. A space before a wrapping word no longer compresses the line in any mode.
