---
'@docx-editor.dev/core': patch
---

In legacy compatibility modes (no declared mode, or mode 11, 12, or 14), lines at every alignment now compress East Asian punctuation to fit, by at most half the added text's width, while Korean text and marks keep their widths. A space before a wrapping word no longer compresses the line in any mode.
