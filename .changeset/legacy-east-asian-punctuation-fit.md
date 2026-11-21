---
'@docx-editor.dev/core': patch
---

Documents in a legacy compatibility mode (no declared mode, or mode 11, 12, or 14) now compress East Asian punctuation to fit lines at every paragraph alignment. In these modes, a fit takes at most half the width of the added text, justified lines included. A group with Korean text wraps, and Korean marks or marks after Hangul keep their widths. A space before a wrapping word no longer compresses the line in any mode.
