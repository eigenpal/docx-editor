---
'@docx-editor.dev/core': patch
---

Documents in a legacy compatibility mode now compress East Asian punctuation to fit lines at every paragraph alignment, with at most half a character of compression for one more character and no fitting of Korean text. A space before a wrapping word no longer compresses the line in any mode.
