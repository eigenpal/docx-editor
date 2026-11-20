---
'@docx-editor.dev/core': patch
---

Documents in a legacy compatibility mode now compress East Asian punctuation to fit lines at every paragraph alignment, with at most half the width of the added text in compression and no fitting of Korean text. A space before a wrapping word no longer compresses the line in any mode.
