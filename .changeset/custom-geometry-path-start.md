---
'@docx-editor.dev/core': patch
---

A custom shape whose path has a command with no current point now paints nothing, with no placeholder, and arcs that sweep more than one turn keep a smooth outline. Fixes #1833
