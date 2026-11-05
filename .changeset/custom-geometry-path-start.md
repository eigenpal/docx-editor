---
'@docx-editor.dev/core': patch
---

Custom shape paths draw nothing before their first `a:moveTo`, and arcs that sweep more than one turn keep a smooth outline. Fixes #1833
