---
'@docx-editor.dev/core': minor
---

Automation text reads report manual line breaks as `\v` and column breaks as U+000E instead of `\n`. Update text processing for these characters; paragraph separators remain `\r`.
