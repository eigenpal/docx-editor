---
'@docx-editor.dev/react': patch
---

Paint the caret in the default theme. `--doc-caret` was declared only inside the dark-mode block, so the caret rendered as a 1px transparent element: correctly positioned and blinking, but invisible.
