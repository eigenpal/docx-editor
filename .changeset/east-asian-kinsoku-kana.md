---
'@docx-editor.dev/core': patch
---

East Asian line-end punctuation hangs only where the line-start rules forbid it, legacy compatibility modes and distributed paragraphs hang it more often, kana compress to fit a line-start-prohibited character, and pair kerning leaves full-width East Asian text unkerned. Fixes #1574, #1575, #1577, #1578, #1581.
