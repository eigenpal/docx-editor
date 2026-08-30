---
'@docx-editor.dev/core': patch
---

Fold the hosted text-box list token into cell, header, and footnote paragraph break keys, so a numbering edit inside a hosted text-box story invalidates the host paragraph's cached break. Fixes #622
