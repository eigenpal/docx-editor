---
'@docx-editor.dev/react': patch
---

Show the caret immediately when it moves. The blink is a free-running cycle that is transparent for half its period, so a click landing in the off phase painted nothing for up to half a second.
