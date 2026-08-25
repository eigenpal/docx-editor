---
'@docx-editor.dev/core': patch
---

Reduce input delay while typing into very large documents: when the browser reports queued input behind an expensive layout pass, a keystroke commits in its own task and layout and paint follow in separate tasks, instead of one blocking flush.
