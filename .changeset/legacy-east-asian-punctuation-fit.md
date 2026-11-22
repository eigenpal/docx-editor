---
'@docx-editor.dev/core': patch
---

In legacy compatibility modes (no declared mode, or mode 11, 12, or 14), lines at every alignment compress East Asian punctuation to fit, and each group of East Asian text that joins a line needs at most half its own width of compression beyond what its own marks give. Korean text wraps, Korean marks keep their widths, and a space before a wrapping word no longer compresses the line in any mode.
