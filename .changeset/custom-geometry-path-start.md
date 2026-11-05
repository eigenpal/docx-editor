---
'@docx-editor.dev/core': patch
---

Custom shape paths draw nothing before their first `a:moveTo`, continue from the subpath start after `a:close`, and keep a smooth outline for arcs that sweep more than one turn. Fixes #1833
