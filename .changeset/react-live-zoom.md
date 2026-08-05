---
'@docx-editor.dev/react': patch
---

Make toolbar and keyboard zoom resize the mounted document without losing edits, selection,
or undo history. Ctrl/Cmd `+`, `-` and `0` now zoom instead of also applying subscript or
superscript to the selection; both remain available from the toolbar.
