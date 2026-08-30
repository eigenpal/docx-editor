---
'@docx-editor.dev/core': patch
---

Hyperlinks inside footnotes and endnotes now resolve their relationship ids against the notes part's own relationships instead of the body part's. Fixes #637
