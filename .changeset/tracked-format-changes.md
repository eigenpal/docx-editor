---
'@docx-editor.dev/core': minor
---

Suggesting mode records a formatting change as a tracked change instead of applying it outright, so a reviewer can reject it and get the previous properties back. Formatting also reaches the same runs through the toolbar and the automation object model, and only the runs the current view shows. Fixes #495, fixes #497, fixes #498
