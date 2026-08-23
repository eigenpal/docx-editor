---
'@docx-editor.dev/core': minor
---

Add `insertContentControl`, so an open editor can create a content control as well as fill and remove one, as a single undoable step.

A collapsed selection inserts an empty control showing its type's prompt, the way Word does, and the first character typed replaces the prompt whole. The same position now works through the automation protocol, which refused it before.
