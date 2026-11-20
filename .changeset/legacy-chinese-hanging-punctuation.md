---
'@docx-editor.dev/core': patch
---

Support the alternate East Asian line-break compatibility setting: a full-width or curly line-end mark outside its language's hanging set no longer hangs, and only its blank half may pass the margin. An interior full-width semicolon now gives up its blank half when a justified line needs room.
