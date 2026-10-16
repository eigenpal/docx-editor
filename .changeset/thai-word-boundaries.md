---
'@docx-editor.dev/core': minor
---

Thai, Lao, Khmer, and Myanmar text now wraps at dictionary word boundaries, table AutoFit sizes columns by the widest word, and lines can break after a zero-width space. Use `isDictionaryWordBreakSupported` and `setDictionaryWordSegmenter` from `@docx-editor.dev/core/layout` to check support or install a dictionary. Fixes #1384
